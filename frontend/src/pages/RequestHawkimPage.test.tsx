import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { requestHawkimEn } from '../content/accessRequest.en'
import { RequestHawkimPage } from './RequestHawkimPage'

vi.mock('../services/accessRequests', () => ({ submitAccessRequest: vi.fn() }))

describe('Request Hawkim page', () => {
  const html = renderToStaticMarkup(<MemoryRouter><RequestHawkimPage /></MemoryRouter>)

  it('asks for the same details as the team’s request email, each with a label', () => {
    for (const label of Object.entries(requestHawkimEn.fields).filter(([key]) => !key.endsWith('Hint')).map(([, value]) => value)) {
      expect(html).toContain(`>${label}`)
    }
    expect(html).toContain('type="email"')
    expect(html).toContain('type="tel"')
    expect(html).toContain('<textarea')
    expect(html).toContain(requestHawkimEn.submit)
  })

  it('has a hidden field for bots that people and screen readers never reach', () => {
    const honeypot = html.match(/<input[^>]*name="website"[^>]*>/)![0]
    expect(honeypot).toContain('tabindex="-1"')
    expect(honeypot).toContain('aria-hidden="true"')
  })
})
