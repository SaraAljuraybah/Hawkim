/** An email to prepare in the visitor's email app. */
export interface MailtoMessage {
  email: string
  subject: string
  body: string
}

/**
 * A mailto: link with the subject and body filled in (URL-encoded; line breaks as
 * CRLF, as mailto links expect). Opens the visitor's email app; nothing is sent from here.
 */
export function mailtoHref({ email, subject, body }: MailtoMessage): string {
  const encode = (text: string) => encodeURIComponent(text.replace(/\r?\n/g, '\r\n'))
  return `mailto:${email}?subject=${encode(subject)}&body=${encode(body)}`
}
