// Request Hawkim's form: checking what the website sent, and the request's details as the review email
// shows them. No Deno here, so the website's tests can import it. Used by index.ts (the single-file
// copy, access-requests-single-file.ts, keeps its own copy of the same code).

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** A link as the Organization Profile takes it: https:// and a host with a dot, no spaces. */
export const HTTPS_LINK = /^https:\/\/[^\s/?#]+\.[^\s]*$/i

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
  /** The organization's details ('' for an optional one not given). Website is `organizationWebsite`: `website` is the hidden field for bots. */
  organizationEmail: string; organizationAddress: string; organizationMapsUrl: string
  organizationWebsite: string; organizationDescription: string
}

/** The cleaned form, or the names of the fields that are not valid. */
export function validateForm(input: Record<string, unknown>): { form: RequestForm } | { invalid: string[] } {
  const text = (k: string) => (typeof input[k] === "string" ? (input[k] as string).trim() : "")
  const invalid: string[] = []
  const organization = text("organization"), contactName = text("contactName"), jobTitle = text("jobTitle")
  const email = text("email").toLowerCase(), message = text("message")
  const phone = normalizePhone(text("phone"))
  const approxUsers = Number(input.approxUsers)
  // The organization's details, with the Organization Profile's rules (save_organization_profile).
  const organizationEmail = text("organizationEmail"), organizationAddress = text("organizationAddress")
  const organizationMapsUrl = text("organizationMapsUrl"), organizationWebsite = text("organizationWebsite")
  const organizationDescription = text("organizationDescription")
  const link = (value: string) => value.length <= 2048 && HTTPS_LINK.test(value)
  if (!organization || organization.length > 200) invalid.push("organization")
  if (!contactName || contactName.length > 100) invalid.push("contactName")
  // Optional: an older form may still send one, and it is checked as before.
  if (jobTitle.length > 100) invalid.push("jobTitle")
  if (!EMAIL.test(email) || email.length > 254) invalid.push("email")
  if (!phone) invalid.push("phone")
  if (!EMAIL.test(organizationEmail) || organizationEmail.length > 254) invalid.push("organizationEmail")
  // An address or a Google Maps link (at least one); the address on one line.
  if ((!organizationAddress && !organizationMapsUrl) || organizationAddress.length > 300 || /\p{Cc}/u.test(organizationAddress)) {
    invalid.push("organizationAddress")
  }
  if (organizationMapsUrl && !link(organizationMapsUrl)) invalid.push("organizationMapsUrl")
  if (organizationWebsite && !link(organizationWebsite)) invalid.push("organizationWebsite")
  if (!organizationDescription || organizationDescription.length > 1000) invalid.push("organizationDescription")
  if (!Number.isInteger(approxUsers) || approxUsers < 1 || approxUsers > 100000) invalid.push("approxUsers")
  if (message.length > 2000) invalid.push("message")
  if (invalid.length) return { invalid }
  return { form: {
    organization, contactName, jobTitle, email, phone: phone!, approxUsers, message,
    organizationEmail, organizationAddress, organizationMapsUrl, organizationWebsite, organizationDescription,
  } }
}

/** The request's details in the review email; Position only when the applicant gave one. */
export function detailsTable(f: RequestForm): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#6D5D62;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:6px 0;color:#2A1B20;">${value}</td></tr>`
  const optional = (value: string) => (value ? esc(value) : "—")
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:12px 0 4px 0;font-size:15px;line-height:22px;">
    ${row("Organization", esc(f.organization))}${row("Contact person", esc(f.contactName))}${f.jobTitle ? row("Position", esc(f.jobTitle)) : ""}
    ${row("Contact person email", esc(f.email))}${row("Phone", esc(f.phone))}
    ${row("Organization email", esc(f.organizationEmail))}${row("Address", optional(f.organizationAddress))}${row("Google Maps link", optional(f.organizationMapsUrl))}
    ${row("Website", optional(f.organizationWebsite))}${row("Description", esc(f.organizationDescription).replace(/\n/g, "<br>"))}
    ${row("Approximate number of users", String(f.approxUsers))}
    ${row("Message", f.message ? esc(f.message).replace(/\n/g, "<br>") : "—")}</table>`
}
