// "Request Hawkim": requests to use Hawkim, reviewed by the Hawkim team (see the migration
// 20261106130000_access_requests.sql). Called by the website with a JSON body { action, ... }:
//   submit  the public form: stores the request, emails the team a review link, confirms to the requester
//   view    the review page: the request, when the review link's id and token match
//   accept  creates the requester's account as Admin and emails them a link to set their password
//   reject  marks the request rejected and tells the requester
//
// Secrets (Dashboard → Edge Functions → Secrets):
//   SNDR_API_KEY       the SNDR API key with the "send" scope (shared with send-email)
//   HAWKIM_SECRET_KEY  optional; the Supabase secret key. Default: SUPABASE_SERVICE_ROLE_KEY,
//                      which Supabase provides to Edge Functions
// Optional settings: SITE_URL (default https://www.tryhawkim.com), REQUESTS_TO (default
// requests@tryhawkim.com), ADMIN_DEPARTMENT (default information-technology), SNDR_FROM, SNDR_API_URL.
//
// Deploy with JWT verification off (the form is public; the website calls it with the publishable key):
//   supabase functions deploy access-requests --no-verify-jwt

import { renderEmail } from "../send-email/templates.ts"

const env = (name: string, fallback = "") => Deno.env.get(name) ?? fallback
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } })
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json(status, { error, ...extra })

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[A-Za-z0-9_-]{43}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ---------- Validation ----------

/** A Saudi mobile number as +9665XXXXXXXX (the profiles.phone format), or undefined. */
export function normalizePhone(input: string): string | undefined {
  const digits = input.replace(/[\s\-().]/g, "")
  const m = digits.match(/^(?:\+966|00966|966|0)?(5\d{8})$/)
  return m ? `+966${m[1]}` : undefined
}

export type RequestForm = {
  organization: string; contactName: string; jobTitle: string; email: string; phone: string
  approxUsers: number; message: string
}

/** The cleaned form, or the names of the fields that are not valid. */
export function validateForm(input: Record<string, unknown>): { form: RequestForm } | { invalid: string[] } {
  const text = (k: string) => (typeof input[k] === "string" ? (input[k] as string).trim() : "")
  const invalid: string[] = []
  const organization = text("organization"), contactName = text("contactName"), jobTitle = text("jobTitle")
  const email = text("email").toLowerCase(), message = text("message")
  const phone = normalizePhone(text("phone"))
  const approxUsers = Number(input.approxUsers)
  if (!organization || organization.length > 200) invalid.push("organization")
  if (!contactName || contactName.length > 100) invalid.push("contactName")
  if (!jobTitle || jobTitle.length > 100) invalid.push("jobTitle")
  if (!EMAIL.test(email) || email.length > 254) invalid.push("email")
  if (!phone) invalid.push("phone")
  if (!Number.isInteger(approxUsers) || approxUsers < 1 || approxUsers > 100000) invalid.push("approxUsers")
  if (message.length > 2000) invalid.push("message")
  if (invalid.length) return { invalid }
  return { form: { organization, contactName, jobTitle, email, phone: phone!, approxUsers, message } }
}

// ---------- Review link token ----------

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

// ---------- Supabase (database functions and Auth admin) ----------

function supabaseHeaders(): Record<string, string> {
  const key = env("HAWKIM_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY")
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }
}

class DbError extends Error {}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${env("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST", headers: supabaseHeaders(), body: JSON.stringify(args),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new DbError(String(body?.message ?? `rpc ${name} ${res.status}`))
  return body as T
}

type LinkResult = { id: string; action_link: string }

/** Creates the account (or finds it, if the email already has a sign-in account) and returns a set-password link. */
async function accountLink(email: string, data: Record<string, unknown>, redirectTo: string): Promise<LinkResult> {
  const url = `${env("SUPABASE_URL").replace(/\/$/, "")}/auth/v1/admin/generate_link`
  const call = (type: string, extra: Record<string, unknown>) =>
    fetch(url, { method: "POST", headers: supabaseHeaders(), body: JSON.stringify({ type, email, redirect_to: redirectTo, ...extra }) })
  let res = await call("invite", { data })
  if (res.status === 422) res = await call("recovery", {}) // a sign-in account already exists (without a Hawkim profile)
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.id || !body?.action_link) throw new Error(`generate_link ${res.status}: ${JSON.stringify(body)?.slice(0, 200)}`)
  return { id: body.id, action_link: body.action_link }
}

// ---------- Email ----------

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch(env("SNDR_API_URL", "https://api.sndr.sh/v1/send"), {
    method: "POST",
    headers: { Authorization: `Bearer ${env("SNDR_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("SNDR_FROM", "Hawkim <no-reply@mail.tryhawkim.com>"), to: [to], subject, html }),
  })
  if (!res.ok) throw new Error(`SNDR ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

function detailsTable(f: RequestForm): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#6D5D62;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:6px 0;color:#2A1B20;">${value}</td></tr>`
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:12px 0 4px 0;font-size:15px;line-height:22px;">
    ${row("Organization", esc(f.organization))}${row("Contact person", esc(f.contactName))}${row("Position", esc(f.jobTitle))}
    ${row("Email", esc(f.email))}${row("Phone", esc(f.phone))}${row("Approximate number of users", String(f.approxUsers))}
    ${row("Message", f.message ? esc(f.message).replace(/\n/g, "<br>") : "—")}</table>`
}

// ---------- Actions ----------

type StoredRequest = {
  id: string; organization: string; contact_name: string; job_title: string; email: string; phone: string
  approx_users: number; message: string; status: "pending" | "accepted" | "rejected"; created_at: string
  decided_at: string | null; expired: boolean; account_exists: boolean
}

async function submit(input: Record<string, unknown>): Promise<Response> {
  // A hidden field people never fill in: if it has a value, a bot filled the form. Pretend it worked.
  if (typeof input.website === "string" && input.website.trim()) return json(200, { ok: true })
  const checked = validateForm(input)
  if ("invalid" in checked) return fail(400, "invalid", { fields: checked.invalid })
  const f = checked.form
  const token = newToken()
  let id: string
  try {
    id = await rpc<string>("submit_access_request", {
      p_organization: f.organization, p_contact_name: f.contactName, p_job_title: f.jobTitle, p_email: f.email,
      p_phone: f.phone, p_approx_users: f.approxUsers, p_message: f.message, p_token_hash: await sha256Hex(token),
    })
  } catch (e) {
    if (e instanceof DbError && e.message === "too_many_requests") return fail(429, "too_many_requests")
    console.error("access-requests: submit failed:", e instanceof Error ? e.message : e)
    return fail(500, "failed")
  }
  const site = env("SITE_URL", "https://www.tryhawkim.com").replace(/\/$/, "")
  const reviewUrl = `${site}/review-request?id=${id}&token=${token}`
  try {
    await sendEmail(env("REQUESTS_TO", "requests@tryhawkim.com"), `Hawkim request: ${f.organization}`, renderEmail({
      subject: `Hawkim request: ${f.organization}`,
      heading: "New request for Hawkim",
      intro: `Hello Hawkim team,<br><br>We would like to request Hawkim for our organization.${detailsTable(f)}`,
      button: "Review request",
      note: "Accepting creates the contact person’s account as the organization’s Admin and emails them a link to set their password. The review link works for 14 days.",
    }, reviewUrl))
  } catch (e) {
    console.error(`access-requests: team email for ${id} failed:`, e instanceof Error ? e.message : e)
    return fail(502, "email_failed")
  }
  try {
    await sendEmail(f.email, "We received your Hawkim request", renderEmail({
      subject: "We received your Hawkim request",
      heading: "Thank you for your request",
      intro: `Hello ${esc(f.contactName)},<br><br>We received your request to use Hawkim for <strong>${esc(f.organization)}</strong>. Our team will review it and reply to this email address.`,
      note: "If you didn’t request Hawkim, you can ignore this email.",
    }, null))
  } catch (e) {
    console.error(`access-requests: confirmation for ${id} failed:`, e instanceof Error ? e.message : e)
  }
  console.log(`access-requests: request ${id} submitted`)
  return json(200, { ok: true })
}

async function load(input: Record<string, unknown>): Promise<{ request: StoredRequest; hash: string } | Response> {
  const id = String(input.id ?? ""), token = String(input.token ?? "")
  if (!UUID.test(id) || !TOKEN.test(token)) return fail(404, "not_found")
  const hash = await sha256Hex(token)
  const rows = await rpc<StoredRequest[]>("get_access_request", { p_id: id, p_token_hash: hash })
  if (!rows.length) return fail(404, "not_found")
  return { request: rows[0], hash }
}

function publicView(r: StoredRequest) {
  return {
    organization: r.organization, contactName: r.contact_name, jobTitle: r.job_title, email: r.email, phone: r.phone,
    approxUsers: r.approx_users, message: r.message, status: r.status, createdAt: r.created_at, decidedAt: r.decided_at,
    expired: r.expired, accountExists: r.account_exists,
  }
}

async function view(input: Record<string, unknown>): Promise<Response> {
  const loaded = await load(input)
  if (loaded instanceof Response) return loaded
  return json(200, { request: publicView(loaded.request) })
}

function undecidable(r: StoredRequest): Response | undefined {
  if (r.status !== "pending") return fail(409, "already_decided", { status: r.status })
  if (r.expired) return fail(410, "expired")
  return undefined
}

async function accept(input: Record<string, unknown>): Promise<Response> {
  const loaded = await load(input)
  if (loaded instanceof Response) return loaded
  const { request: r, hash } = loaded
  const blocked = undecidable(r)
  if (blocked) return blocked
  if (r.account_exists) return fail(409, "email_in_use")

  const site = env("SITE_URL", "https://www.tryhawkim.com").replace(/\/$/, "")
  let link: LinkResult
  try {
    link = await accountLink(r.email, { full_name: r.contact_name, organization: r.organization }, `${site}/reset-password`)
  } catch (e) {
    console.error(`access-requests: account for ${r.id} failed:`, e instanceof Error ? e.message : e)
    return fail(502, "account_failed")
  }
  try {
    await rpc("accept_access_request", { p_id: r.id, p_token_hash: hash, p_user_id: link.id, p_department: env("ADMIN_DEPARTMENT", "information-technology") })
  } catch (e) {
    const code = e instanceof DbError ? e.message : "failed"
    console.error(`access-requests: accept ${r.id} failed:`, code)
    if (code === "email_in_use") return fail(409, "email_in_use")
    if (code === "request_already_decided") return fail(409, "already_decided")
    if (code === "review_link_expired") return fail(410, "expired")
    return fail(500, "failed")
  }
  let emailSent = true
  try {
    await sendEmail(r.email, "Your Hawkim account is ready", renderEmail({
      subject: "Your Hawkim account is ready",
      heading: "Welcome to Hawkim",
      intro: `Hello ${esc(r.contact_name)},<br><br>Your request to use Hawkim for <strong>${esc(r.organization)}</strong> was accepted. You are the organization’s <strong>Admin</strong>: set your password to sign in, then invite your colleagues.`,
      button: "Set your password",
      note: `Sign in with this email address (${esc(r.email)}). If the link has expired, use “Forgot password?” on the sign-in page.`,
    }, link.action_link))
  } catch (e) {
    emailSent = false
    console.error(`access-requests: welcome email for ${r.id} failed:`, e instanceof Error ? e.message : e)
  }
  console.log(`access-requests: request ${r.id} accepted`)
  return json(200, { ok: true, emailSent })
}

async function reject(input: Record<string, unknown>): Promise<Response> {
  const loaded = await load(input)
  if (loaded instanceof Response) return loaded
  const { request: r, hash } = loaded
  const blocked = undecidable(r)
  if (blocked) return blocked
  try {
    await rpc("reject_access_request", { p_id: r.id, p_token_hash: hash })
  } catch (e) {
    const code = e instanceof DbError ? e.message : "failed"
    if (code === "request_already_decided") return fail(409, "already_decided")
    if (code === "review_link_expired") return fail(410, "expired")
    return fail(500, "failed")
  }
  try {
    await sendEmail(r.email, "About your Hawkim request", renderEmail({
      subject: "About your Hawkim request",
      heading: "About your Hawkim request",
      intro: `Hello ${esc(r.contact_name)},<br><br>Thank you for your interest in Hawkim. We are not able to set up Hawkim for <strong>${esc(r.organization)}</strong> at this time.`,
      note: "You are welcome to contact us again in the future.",
    }, null))
  } catch (e) {
    console.error(`access-requests: rejection email for ${r.id} failed:`, e instanceof Error ? e.message : e)
  }
  console.log(`access-requests: request ${r.id} rejected`)
  return json(200, { ok: true })
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return fail(405, "method_not_allowed")
  if (!env("SUPABASE_URL") || !(env("HAWKIM_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY")) || !env("SNDR_API_KEY")) {
    return fail(500, "not_configured")
  }
  let input: Record<string, unknown>
  try {
    input = await req.json()
  } catch {
    return fail(400, "invalid")
  }
  try {
    switch (input?.action) {
      case "submit": return await submit(input)
      case "view": return await view(input)
      case "accept": return await accept(input)
      case "reject": return await reject(input)
      default: return fail(400, "invalid")
    }
  } catch (e) {
    console.error("access-requests: unexpected error:", e instanceof Error ? e.message : e)
    return fail(500, "failed")
  }
}

if (import.meta.main) Deno.serve(handle)
