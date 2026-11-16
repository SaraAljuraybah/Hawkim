// Staff → Sent Invitations in Chrome, against the LOCAL stack and app only:
//   supabase start; supabase functions serve --env-file <file> (see staff_invitations.local.mjs)
//   (frontend) VITE_SUPABASE_URL=<local API URL> VITE_SUPABASE_PUBLISHABLE_KEY=<local anon key> npx vite --port 5179
//   npm install puppeteer-core in any folder (it isn't a project dependency), then:
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon key> SUPABASE_SERVICE_ROLE_KEY=<service key> \
//   PUPPETEER_CORE_DIR=<that folder> CHROME_PATH=<chrome executable> [SCREENSHOT_DIR=<folder>] \
//   node supabase/tests/staff_invitations.browser.local.mjs
//
// Clicks through the tab as an Admin: the third tab, the note, the columns, the badges, the fixed actions (Resend
// disabled with its tooltip while Sent), Preview, the status Filter, the search, Resend on an Expired invitation,
// Cancel with its confirmation, Active Staff without invited people, the cancelled link's message, and Add Staff
// inviting the cancelled person again.
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { localPeople, owner, lit } from './local_people.mjs'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const puppeteerPath = createRequire(`${process.env.PUPPETEER_CORE_DIR ?? '.'}/`).resolve('puppeteer-core')
const { default: puppeteer } = await import(pathToFileURL(puppeteerPath).href)
const url = process.env.SUPABASE_URL ?? ''
const anonKey = process.env.SUPABASE_ANON_KEY ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const APP = process.env.HAWKIM_APP_URL ?? 'http://127.0.0.1:5179'
const mockPort = Number(process.env.SNDR_MOCK_PORT ?? 56498)
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url) || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(APP) || !anonKey || !serviceKey) {
  console.error('Refusing to run: the Supabase stack and the app must both be local, with both keys set.')
  process.exit(2)
}
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(url, serviceKey, options)
const run = randomUUID().slice(0, 6)
const db = owner()
const people = localPeople({ url, anonKey, service, options, run, prefix: 'ui-inv' })
const results = []
let failed = 0
async function check(name, fn) {
  try { await fn(); results.push(`PASS  ${name}`) } catch (error) { failed++; results.push(`FAIL  ${name}: ${error.message.split('\n')[0]}`) }
}
const assert = (condition, message) => { if (!condition) throw new Error(message) }

// ---------- A stand-in for the SNDR email API ----------
const mailbox = []
const mock = createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    const message = JSON.parse(body || '{}')
    mailbox.push({ to: message.to?.[0], html: message.html ?? '' })
    response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"id":"local"}')
  })
})
await new Promise((resolve) => mock.listen(mockPort, '0.0.0.0', resolve))
const linkTo = (email) => mailbox.filter((m) => m.to === email).at(-1)?.html.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)?.[1]?.replaceAll('&amp;', '&')

// ---------- People: an Admin, and two invited staff (one Sent, one Expired) ----------
const admin = await people.person('admin', 'quality-assurance', ['admin'])
const invite = async (key, permissions, phone) => {
  const details = { name: `UI Invited ${key} ${run}`, email: `ui-inv-${key}-${run}@test.invalid`, phone, position: 'Officer', departmentId: 'regulatory-affairs', permissions }
  const { data, error } = await admin.client.functions.invoke('add-user', { body: details })
  if (error || !data?.user?.id) throw new Error(`add-user ${key}: ${error?.message} ${JSON.stringify(await error?.context?.json?.().catch(() => null))}`)
  return { ...details, id: data.user.id }
}
const rana = await invite('rana', ['author', 'reviewer'], `+9665${String(Date.now()).slice(-8)}`)
const omar = await invite('omar', ['author'], `+9665${String(Date.now() + 1).slice(-8)}`)
await db.run(`update public.user_invitations set sent_at = now() - interval '25 hours' where user_id = ${lit(omar.id)};`)

// ---------- Chrome ----------
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run'] })
const context = await browser.createBrowserContext()
const page = await context.newPage()
await page.setViewport({ width: 1366, height: 900 })
page.setDefaultTimeout(30000)
// Leaving a form on purpose answers the browser's own "Leave site?" with Leave.
page.on('dialog', (dialog) => void dialog.accept())
await page.goto(`${APP}/login`, { waitUntil: 'networkidle2' })
await page.type('input[name="email"]', admin.email)
await page.type('input[name="password"]', admin.password)
await page.click('button[type="submit"]')
await page.waitForFunction(() => location.pathname !== '/login')

const text = () => page.evaluate(() => document.body.innerText)
const waitText = (value, timeout = 15000) => page.waitForFunction((v) => document.body.innerText.includes(v), { timeout }, value)
const shot = async (name) => { if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true }) }
/** The visible table's rows: name, cells' text, and the buttons (label, disabled). */
const rows = () => page.evaluate(() => [...document.querySelectorAll('table tbody tr')].map((tr) => ({
  name: tr.querySelector('th')?.innerText.trim(),
  cells: [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()),
  buttons: [...tr.querySelectorAll('td:last-child button')].map((b) => ({ label: b.getAttribute('aria-label'), disabled: b.getAttribute('aria-disabled') === 'true' })),
})))
// The heading holds the avatar's initials too.
const row = async (name) => (await rows()).find((r) => r.name?.includes(name))
const press = async (label) => {
  const button = await page.waitForSelector(`table button[aria-label="${label}"]`, { visible: true })
  await button.click()
}
async function openTab() {
  await page.goto(`${APP}/admin/users?status=invitations`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('table tbody tr')
}

await check('1. The third tab, the note above the table and the five columns', async () => {
  await openTab()
  const tabs = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => `${t.innerText}:${t.getAttribute('aria-selected')}`))
  assert(tabs.join() === 'Active Staff:false,Deactivated Staff:false,Sent Invitations:true', `tabs ${tabs}`)
  await waitText('Invitations expire 24 hours after being sent. Expired invitations can be resent.')
  const headings = await page.evaluate(() => [...document.querySelectorAll('table thead th')].map((th) => th.innerText.trim()))
  assert(headings.join('|') === 'Full Name|Email|Invitation Status|Sent Date|Actions', `columns ${headings}`)
  await shot('sent-invitations')
})

await check('2. Status badges in the table, and the fixed actions: Resend disabled with its tooltip while Sent', async () => {
  const r = await row(rana.name), o = await row(omar.name)
  assert(r && o, 'both invitations listed')
  assert(r.cells[0].includes(rana.email) && r.cells[1] === 'Sent' && o.cells[1] === 'Expired', `cells ${JSON.stringify([r.cells, o.cells])}`)
  const actions = r.buttons.filter((b) => !b.label.startsWith('Copy'))
  assert(actions.map((b) => b.label.split(' ')[0]).join() === 'Preview,Resend,Cancel', `order ${JSON.stringify(actions)}`)
  assert(actions[1].disabled && !actions[0].disabled && !actions[2].disabled, 'Resend disabled while Sent')
  assert(!o.buttons.some((b) => b.disabled), 'all enabled when Expired')
  const resend = await page.$(`table button[aria-label="Resend invitation to ${rana.name}"]`)
  await resend.hover()
  await waitText('Available when the invitation expires.')
})

await check('3. Preview shows the Add Staff details, with every permission', async () => {
  await press(`Preview ${rana.name}`)
  await page.waitForSelector('dialog[open]')
  const dialog = await page.evaluate(() => document.querySelector('dialog[open]').innerText)
  for (const value of ['Full Name', 'Email', rana.email, 'Phone Number', rana.phone, 'Division', 'Department', 'Regulatory Affairs', 'Position', 'Officer', 'Permission', 'Author', 'Reviewer']) {
    assert(dialog.includes(value), `preview has ${value}`)
  }
  assert(!dialog.includes('Sent Date') && !dialog.includes('Invitation Status'), 'no status or date repeated')
  await shot('preview')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))
})

await check('4. The existing Filter offers All Statuses, Sent and Expired; the search matches name and email', async () => {
  const filter = await page.waitForSelector('::-p-xpath(//button[.//text()[contains(., "All Statuses")]])')
  await filter.click()
  const expired = await page.waitForSelector('::-p-xpath(//button[@aria-pressed and normalize-space(.)="Expired"])', { visible: true })
  await shot('filter')
  await expired.click()
  await page.waitForFunction((name) => ![...document.querySelectorAll('table tbody th')].some((th) => th.innerText.includes(name)), {}, rana.name)
  assert((await rows()).every((r) => r.cells[1] === 'Expired'), 'only Expired')
  await page.keyboard.press('Escape')
  await openTab()
  await page.type('input[name="search"]', rana.email.slice(0, 12))
  await page.waitForFunction((name) => ![...document.querySelectorAll('table tbody th')].some((th) => th.innerText.includes(name)), {}, omar.name)
  assert((await row(rana.name)), 'found by email')
})

await check('5. Resend on an Expired invitation: no confirmation, Sent again, Resend disabled again', async () => {
  await openTab()
  const before = (await row(omar.name)).cells[2]
  await press(`Resend invitation to ${omar.name}`)
  await waitText(`Invitation sent to ${omar.email}`)
  const after = await row(omar.name)
  assert(after.cells[1] === 'Sent', `status ${after.cells[1]}`)
  assert(after.buttons.find((b) => b.label.startsWith('Resend')).disabled, 'Resend disabled again')
  assert(after.cells[2] !== before || before.length > 0, 'Sent Date shown')
})

await check('6. Cancel asks first, then removes the invitation; the person is on neither Active nor Deactivated Staff', async () => {
  await press(`Cancel invitation for ${rana.name}`)
  await page.waitForSelector('dialog[open]')
  const dialog = await page.evaluate(() => document.querySelector('dialog[open]').innerText)
  assert(dialog.includes(`Cancel invitation for ${rana.name}?`) && dialog.includes('Cancelling invalidates the invitation'), `dialog ${dialog}`)
  await shot('cancel-dialog')
  const confirm = await page.waitForSelector('::-p-xpath(//dialog[@open]//button[normalize-space(.)="Cancel Invitation"])')
  await confirm.click()
  await waitText(`The invitation for ${rana.name} was cancelled.`)
  assert(!(await row(rana.name)), 'removed from the list')
  for (const status of ['active', 'deactivated']) {
    await page.goto(`${APP}/admin/users?status=${status}`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('[role="tabpanel"]')
    assert(!(await text()).includes(rana.name), `not on ${status}`)
  }
  assert(!(await text()).includes(omar.name), 'an invited person is not on Active Staff either')
})

await check('7. The cancelled link says "This invitation has been cancelled."', async () => {
  const link = linkTo(rana.email)
  assert(link, 'the emailed link')
  const visitor = await (await browser.createBrowserContext()).newPage()
  await visitor.goto(link, { waitUntil: 'networkidle2' })
  await visitor.waitForFunction(() => document.body.innerText.includes('This invitation has been cancelled.'), { timeout: 20000 })
  assert(!(await visitor.evaluate(() => document.querySelector('input[type="password"]'))), 'no password form')
  if (process.env.SCREENSHOT_DIR) await visitor.screenshot({ path: `${process.env.SCREENSHOT_DIR}/cancelled-link.png` })
})

await check('8. Add Staff with the cancelled email invites the same person again: back on Sent Invitations, not Active Staff', async () => {
  await page.goto(`${APP}/admin/users/new`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[name="name"]', { visible: true })
  await page.type('input[name="name"]', rana.name)
  await page.type('input[name="email"]', rana.email)
  await page.type('input[name="phone"]', rana.phone.slice(5))
  for (const [name, label] of [['division', 'No Division'], ['department', 'Regulatory Affairs']]) {
    await page.click(`input[name="${name}"]`, { clickCount: 3 })
    await page.type(`input[name="${name}"]`, label)
    const option = await page.waitForSelector(`::-p-xpath(//li[@role="option" and normalize-space(.)="${label}"])`, { timeout: 5000 })
    await option.click()
  }
  await page.type('input[name="position"]', 'Senior Officer')
  await page.click('input[name="permissions"][value="author"]')
  assert(!(await text()).includes('already exists'), 'the email is not called taken')
  const submit = await page.waitForSelector('::-p-xpath(//button[normalize-space(.)="Add Staff"])')
  await submit.click()
  try {
    await page.waitForFunction(() => /^\/admin\/users\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 30000 })
  } catch (error) {
    await shot('reinvite-stuck')
    throw new Error(`stayed on ${new URL(page.url()).pathname}: ${(await text()).slice(0, 600).split(/\s*\n\s*/).join(' | ')}`)
  }
  assert(page.url().endsWith(`/admin/users/${rana.id}`), 'the same staff member')
  await openTab()
  const back = await row(rana.name)
  assert(back && back.cells[1] === 'Sent', `back on Sent Invitations: ${JSON.stringify(back)}`)
  await page.goto(`${APP}/admin/users`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[role="tabpanel"]')
  assert(!(await text()).includes(rana.name), 'not on Active Staff')
  await shot('reinvited')
})

await browser.close()
mock.close()
console.log(results.join('\n'))
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
