// Supabase Send Email Hook: sends Hawkim's auth emails (password reset, invitation, ...) through SNDR.
//
// Secrets (Dashboard → Edge Functions → Secrets, or `supabase secrets set`):
//   SEND_EMAIL_HOOK_SECRET  the hook's signing secret from Authentication → Hooks ("v1,whsec_...")
//   SNDR_API_KEY            an SNDR API key with the "send" scope
//   SNDR_FROM               optional; default "Hawkim <no-reply@mail.tryhawkim.com>"
//   SNDR_API_URL            optional; default "https://api.sndr.sh/v1/send" (for tests)
// SUPABASE_URL is provided by Supabase automatically.
//
// Deploy with JWT verification off (Supabase Auth calls it, not a signed-in user):
//   supabase functions deploy send-email --no-verify-jwt

import { Webhook } from "npm:standardwebhooks@1.0.0"
import { contentFor, renderEmail } from "./templates.ts"

type HookPayload = {
  user: { email: string }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: string
    site_url: string
    token_new?: string
    token_hash_new?: string
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

/** The error shape Supabase Auth shows when a hook fails. */
const hookError = (status: number, message: string) => json(status, { error: { http_code: status, message } })

/** The same verification link Supabase builds for {{ .ConfirmationURL }}. */
function actionLink(supabaseUrl: string, tokenHash: string, type: string, redirectTo: string): string {
  const u = new URL(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/verify`)
  u.searchParams.set("token", tokenHash)
  u.searchParams.set("type", type)
  if (redirectTo) u.searchParams.set("redirect_to", redirectTo)
  return u.toString()
}

async function sendWithSndr(apiKey: string, message: Record<string, unknown>): Promise<void> {
  const res = await fetch(Deno.env.get("SNDR_API_URL") ?? "https://api.sndr.sh/v1/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(message),
  })
  if (!res.ok) throw new Error(`SNDR ${res.status}: ${(await res.text()).slice(0, 300)}`)
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return hookError(405, "Method not allowed")
  const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET")
  const apiKey = Deno.env.get("SNDR_API_KEY")
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  if (!hookSecret || !apiKey || !supabaseUrl) return hookError(500, "Email sending is not configured")

  // Only Supabase Auth can call this: check the signed request.
  const body = await req.text()
  let payload: HookPayload
  try {
    const wh = new Webhook(hookSecret.replace("v1,whsec_", ""))
    payload = wh.verify(body, Object.fromEntries(req.headers)) as HookPayload
  } catch {
    return hookError(401, "Invalid signature")
  }

  const { user, email_data: d } = payload
  const type = d.email_action_type
  const content = contentFor(type, user.email)
  const isCodeOnly = type === "reauthentication"
  const link = isCodeOnly ? null : actionLink(supabaseUrl, d.token_hash, type, d.redirect_to || d.site_url)
  const code = isCodeOnly ? d.token : undefined

  try {
    await sendWithSndr(apiKey, {
      from: Deno.env.get("SNDR_FROM") ?? "Hawkim <no-reply@mail.tryhawkim.com>",
      to: [user.email],
      subject: content.subject,
      html: renderEmail(content, link, code),
    })
  } catch (e) {
    console.error(`send-email: ${type} to ${user.email} failed:`, e instanceof Error ? e.message : e)
    return hookError(502, "The email could not be sent")
  }
  console.log(`send-email: ${type} sent to ${user.email}`)
  return json(200, {})
})
