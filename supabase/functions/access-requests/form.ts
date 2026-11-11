// Request Hawkim's form: checking what the website sent, and the request's details as the review email
// shows them. No Deno here, so the website's tests can import it. Used by index.ts (the single-file
// copy, access-requests-single-file.ts, keeps its own copy of the same code).

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A Saudi mobile number as +9665XXXXXXXX (the profiles.phone format), or undefined. */
export function normalizePhone(input: string): string | undefined {
  const digits = input.replace(/[\s\-().]/g, "")
  const m = digits.match(/^(?:\+966|00966|966|0)?(5\d{8})$/)
  return m ? `+966${m[1]}` : undefined
}

export type RequestForm = {
  /** No longer asked (the applicant becomes the Super Admin, and Admins have no position): '' when not sent. */
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
  // Optional: an older form may still send one, and it is checked as before.
  if (jobTitle.length > 100) invalid.push("jobTitle")
  if (!EMAIL.test(email) || email.length > 254) invalid.push("email")
  if (!phone) invalid.push("phone")
  if (!Number.isInteger(approxUsers) || approxUsers < 1 || approxUsers > 100000) invalid.push("approxUsers")
  if (message.length > 2000) invalid.push("message")
  if (invalid.length) return { invalid }
  return { form: { organization, contactName, jobTitle, email, phone: phone!, approxUsers, message } }
}

/** The request's details in the review email; Position only when the applicant gave one. */
export function detailsTable(f: RequestForm): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#6D5D62;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:6px 0;color:#2A1B20;">${value}</td></tr>`
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:12px 0 4px 0;font-size:15px;line-height:22px;">
    ${row("Organization", esc(f.organization))}${row("Contact person", esc(f.contactName))}${f.jobTitle ? row("Position", esc(f.jobTitle)) : ""}
    ${row("Email", esc(f.email))}${row("Phone", esc(f.phone))}${row("Approximate number of users", String(f.approxUsers))}
    ${row("Message", f.message ? esc(f.message).replace(/\n/g, "<br>") : "—")}</table>`
}
