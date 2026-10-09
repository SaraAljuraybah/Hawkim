import { describe, expect, it } from 'vitest'
import { mailtoHref } from './mailto'

describe('mailtoHref', () => {
  it('fills in the subject and body, URL-encoded with CRLF line breaks', () => {
    const href = mailtoHref({ email: 'team@example.com', subject: 'Hawkim request', body: 'Hello,\n\nOrganization: A & B?' })
    expect(href).toBe(
      'mailto:team@example.com?subject=Hawkim%20request&body=Hello%2C%0D%0A%0D%0AOrganization%3A%20A%20%26%20B%3F',
    )
  })
})
