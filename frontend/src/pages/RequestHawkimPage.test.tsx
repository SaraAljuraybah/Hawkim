import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { requestHawkimEn } from '../content/accessRequest.en'
import { RequestHawkimPage } from './RequestHawkimPage'

vi.mock('../services/accessRequests', () => ({ submitAccessRequest: vi.fn() }))

describe('Request Hawkim page', () => {
  const html = renderToStaticMarkup(<MemoryRouter><RequestHawkimPage /></MemoryRouter>)

  it('asks for the same details as the team’s request email, each with a label', () => {
    for (const label of Object.entries(requestHawkimEn.fields).filter(([key]) => !/(Hint|Placeholder|Counter)$/.test(key)).map(([, value]) => value)) {
      expect(html).toContain(`>${label}`)
    }
    expect(html).toContain('type="email"')
    // The phone: the 8 digits after a fixed "+9665", with the number keyboard; the prefix read before the hint.
    expect(html).toMatch(/<input id="[^"]+" aria-describedby="([^"]+) [^"]+-hint"[^>]*inputMode="numeric"[^>]*name="phone"[^>]*\/><div[^>]*><span id="\1">\+9665<\/span>/)
    expect(html).toContain('>Saudi mobile number: +9665XXXXXXXX</p>')
    expect(requestHawkimEn.errors.phone).toBe('Enter the 8 digits after +9665.')
    expect(html).toContain('<textarea')
    expect(html).toContain(requestHawkimEn.submit)
  })

  it('has a hidden field for bots that people and screen readers never reach', () => {
    const honeypot = html.match(/<input[^>]*name="website"[^>]*>/)![0]
    expect(honeypot).toContain('tabindex="-1"')
    expect(honeypot).toContain('aria-hidden="true"')
  })

  it('marks the required fields like the other forms, and labels the message (Optional) with a counter', () => {
    const marks = html.match(/<span[^>]*text-status-rejected-fg[^>]*>\*<\/span>/g) ?? []
    expect(marks).toHaveLength(6)
    expect(html).toContain('>Message (Optional)<')
    expect(html).not.toContain('>Optional.<')
    expect(html).toContain('0 / 2000')
  })
})

