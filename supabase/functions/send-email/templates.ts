// Hawkim auth email templates (HTML for email clients: tables and inline styles only).
// Colours follow the website: burgundy #3E0E1C, gold #C8A15C, cream #F6F1EA.

export type EmailContent = { subject: string; heading: string; intro: string; button?: string; note: string; code?: string }

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")

/** The copy for each Supabase auth email type. `email` is the recipient's address. */
export function contentFor(type: string, email: string): EmailContent {
  const who = esc(email)
  switch (type) {
    case "recovery":
      return {
        subject: "Reset your Hawkim password",
        heading: "Reset your password",
        intro: `We received a request to reset the password for the Hawkim account <strong>${who}</strong>. Choose a new password with the button below.`,
        button: "Set a new password",
        note: "This link expires in 24 hours and can be used once. If you didn’t ask to reset your password, you can ignore this email; your password stays the same.",
      }
    case "invite":
      return {
        subject: "You’re invited to Hawkim",
        heading: "You’re invited to Hawkim",
        intro: `A Hawkim Admin has created an account for <strong>${who}</strong>. Accept this invitation to access the platform and set your password.`,
        button: "Accept invitation",
        note: "This link expires in 24 hours and can be used once. If you weren’t expecting this invitation, you can ignore this email.",
      }
    case "signup":
      return {
        subject: "Confirm your Hawkim account",
        heading: "Confirm your email address",
        intro: `Confirm that <strong>${who}</strong> is your email address to finish setting up your Hawkim account.`,
        button: "Confirm email",
        note: "This link expires in 24 hours and can be used once. If you didn’t create a Hawkim account, you can ignore this email.",
      }
    case "magiclink":
      return {
        subject: "Your Hawkim sign-in link",
        heading: "Sign in to Hawkim",
        intro: `Use the button below to sign in as <strong>${who}</strong>.`,
        button: "Sign in",
        note: "This link expires in 24 hours and can be used once. If you didn’t ask to sign in, you can ignore this email.",
      }
    case "email_change":
      return {
        subject: "Confirm your new Hawkim email address",
        heading: "Confirm your email change",
        intro: `Confirm the change of the email address for your Hawkim account. This message was sent to <strong>${who}</strong>.`,
        button: "Confirm email change",
        note: "This link expires in 24 hours and can be used once. If you didn’t ask to change your email address, contact your Admin.",
      }
    case "reauthentication":
      return {
        subject: "Your Hawkim verification code",
        heading: "Confirm it’s you",
        intro: `Enter this code in Hawkim to confirm the action for <strong>${who}</strong>.`,
        note: "The code expires in 24 hours. If you didn’t ask for it, contact your Admin.",
      }
    default:
      return {
        subject: "A message from Hawkim",
        heading: "Hawkim account",
        intro: `This message is about the Hawkim account <strong>${who}</strong>.`,
        button: "Open Hawkim",
        note: "If you weren’t expecting this email, you can ignore it.",
      }
  }
}

/** The full email HTML. `link` is the action link; `code` is shown for code-only emails. */
export function renderEmail(c: EmailContent, link: string | null, code?: string): string {
  const url = link ? esc(link) : ""
  const button = c.button && link ? `
          <tr><td style="padding:8px 0 24px 0;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
              <td bgcolor="#3E0E1C" style="border-radius:8px;">
                <a href="${url}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:8px;">${c.button}</a>
              </td></tr></table>
          </td></tr>
          <tr><td style="padding:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#6D5D62;">
            If the button doesn’t work, copy this link into your browser:<br>
            <a href="${url}" target="_blank" style="color:#6B1F33;word-break:break-all;">${url}</a>
          </td></tr>` : ""
  const codeBlock = code ? `
          <tr><td style="padding:8px 0 24px 0;">
            <div style="display:inline-block;padding:14px 22px;background:#F6F1EA;border:1px solid #E6DDD3;border-radius:8px;font-family:'Courier New',monospace;font-size:28px;letter-spacing:6px;font-weight:bold;color:#3E0E1C;">${esc(code)}</div>
          </td></tr>` : ""
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#F6F1EA;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F6F1EA;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E6DDD3;border-radius:12px;overflow:hidden;">
      <tr><td bgcolor="#3E0E1C" style="padding:22px 32px;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#FFFFFF;letter-spacing:.3px;">Hawkim</td></tr>
      <tr><td bgcolor="#C8A15C" style="height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>
      <tr><td style="padding:32px 32px 8px 32px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><td style="padding:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:30px;font-weight:bold;color:#3E0E1C;">${c.heading}</td></tr>
          <tr><td style="padding:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#2A1B20;">${c.intro}</td></tr>
          ${button}${codeBlock}
          <tr><td style="padding:16px 0 28px 0;border-top:1px solid #E6DDD3;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#6D5D62;">${c.note}</td></tr>
        </table>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
      <tr><td style="padding:18px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#8A7B7F;text-align:center;">
        Hawkim · SOP compliance for pharmacovigilance<br>This is an automated message; replies are not monitored.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

/** A plain-text version for email clients that don't show HTML. */
export function renderText(c: EmailContent, link: string | null, code?: string): string {
  const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  return [c.heading, "", strip(c.intro), "", link ? `${c.button ?? "Open"}: ${link}` : "", code ? `Code: ${code}` : "", "", strip(c.note), "", "Hawkim"]
    .filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n")
}
