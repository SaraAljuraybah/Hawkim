// For the rehearsal on the local stack (docs/multi-tenancy.md): stands in for the email API the Edge
// Functions use (SNDR) and hands every email to the local stack's Mailpit, so nothing is sent to anyone and
// the links in them (e.g. a Request Hawkim's review link) can be opened at http://127.0.0.1:54324.
//
//   node supabase/scripts/local_email_to_mailpit.mjs        (keep it running; Ctrl+C to stop)
//
// with, in supabase/functions/.env:  SNDR_API_URL=http://host.docker.internal:56499/v1/send
// It listens on port 56499 (SNDR_MOCK_PORT to change it) on every interface, because the Edge Functions run
// in Docker and reach it through host.docker.internal; it only ever forwards to Mailpit on 127.0.0.1.
import { createServer } from 'node:http'

const port = Number(process.env.SNDR_MOCK_PORT ?? 56499)
const mailpit = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(mailpit)) {
  console.error('Refusing: MAILPIT_URL must be the local Mailpit')
  process.exit(2)
}

/** "Hawkim <no-reply@x>" → { Name, Email }. */
function address(text) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(text ?? '')
  return match ? { Name: match[1], Email: match[2] } : { Email: String(text ?? '').trim() }
}

createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  try {
    if (req.method !== 'POST') throw new Error(`${req.method} not supported`)
    const mail = JSON.parse(body)
    const to = (Array.isArray(mail.to) ? mail.to : [mail.to]).map(address)
    const sent = await fetch(`${mailpit}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ From: address(mail.from), To: to, Subject: mail.subject ?? '', HTML: mail.html ?? '' }),
    })
    if (!sent.ok) throw new Error(`Mailpit ${sent.status}: ${await sent.text()}`)
    console.log(`→ Mailpit: "${mail.subject}" to ${to.map((a) => a.Email).join(', ')}`)
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: 'mailpit' }))
  } catch (error) {
    console.error(`not delivered: ${error.message}`)
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }))
  }
}).listen(port, '0.0.0.0', () => console.log(`Emails to Mailpit (${mailpit}), listening on port ${port}. Ctrl+C to stop.`))
