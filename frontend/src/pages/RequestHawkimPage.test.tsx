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
    // Contact person name, Contact person email, Phone, Organization name, Organization email, the Address group's title,
    // Description and Approximate number of users (no Position).
    expect(marks).toHaveLength(8)
    expect(html).toContain('>Message (Optional)<')
    expect(html).not.toContain('>Optional.<')
    expect(html).toContain('0 / 2000')
  })

  it('has no Position field (the applicant becomes the Super Admin, and Admins have no position)', () => {
    expect(html).not.toContain('>Position')
    expect(html).not.toContain('organization-title')
  })

  it('asks for the organization and its details first, then the contact person, then the message', () => {
    expect([...html.matchAll(/<(?:input|textarea)[^>]*name="([^"]+)"/g)].map((match) => match[1])).toEqual([
      'organization', 'organizationEmail', 'organizationAddress', 'organizationMapsUrl',
      'organizationWebsite', 'organizationDescription', 'approxUsers', 'contactName', 'email', 'phone', 'message', 'website',
    ])
    expect(html).toContain('>Contact person email<')
    expect(html).toContain('>Website (Optional)<')
    expect(html).toContain('0 / 1000')
    // The organization email and the description are required; the website and the two Address boxes are not.
    const control = (name: string) => html.match(new RegExp(`<(?:input|textarea)[^>]*name="${name}"[^>]*>`))![0]
    for (const name of ['organizationEmail', 'organizationDescription']) expect(control(name)).toContain('required=""')
    for (const name of ['organizationAddress', 'organizationMapsUrl', 'organizationWebsite']) expect(control(name)).not.toContain('required=""')
    expect(control('organizationMapsUrl')).toContain('type="url"')
    expect(control('organizationWebsite')).toContain('type="url"')
  })

  it('puts the address and the Google Maps link in one required Address group, "or" between them, the rule as a hint', () => {
    const box = html.match(/<fieldset aria-describedby[^>]*>(.*?)<\/fieldset>/)![0]
    expect(box).toMatch(/<legend[^>]*>Address<span aria-hidden="true"[^>]*>\*<\/span><\/legend>/)
    const hintId = box.match(/<p id="([^"]+)"[^>]*>Enter an address, a Google Maps link, or both\.<\/p>/)![1]
    expect(box).toMatch(new RegExp(`^<fieldset aria-describedby="${hintId}"`))
    for (const name of ['organizationAddress', 'organizationMapsUrl']) {
      expect(box).toMatch(new RegExp(`<input[^>]*aria-describedby="${hintId}[^"]*"[^>]*name="${name}"`))
    }
    expect(box).toMatch(/<span aria-hidden="true"[^>]*>or<\/span>/)
  })

  it('puts the fields in two bordered groups styled like the Address group was: Organization, then Contact person', () => {
    const groups = [...html.matchAll(/<fieldset class="min-w-0 rounded-lg border border-beige p-4 "><legend class="px-1 text-sm font-bold text-maroon">([^<]+)<\/legend>/g)].map((match) => match[1])
    expect(groups).toEqual(['Organization', 'Contact person'])
    const organization = html.slice(html.indexOf('>Organization</legend>'), html.indexOf('>Contact person</legend>'))
    for (const name of ['organization', 'organizationEmail', 'organizationAddress', 'organizationMapsUrl', 'organizationWebsite', 'organizationDescription', 'approxUsers']) {
      expect(organization).toContain(`name="${name}"`)
    }
    const contact = html.slice(html.indexOf('>Contact person</legend>'), html.indexOf('name="message"'))
    for (const name of ['contactName', 'email', 'phone']) expect(contact).toContain(`name="${name}"`)
    // The message comes after both groups.
    expect(html.indexOf('>Contact person</legend>')).toBeLessThan(html.indexOf('name="message"'))
  })

  it('keeps Address as a sub-group of Organization, without a second border, its legend like a field label', () => {
    const address = html.match(/<fieldset aria-describedby="[^"]+" class="([^"]*)"><legend class="([^"]*)">Address/)!
    expect(address[1]).not.toContain('border')
    expect(address[2]).toBe('mb-1.5 text-sm font-medium text-maroon')
  })

  it('keeps the required asterisks', () => {
    for (const label of ['Organization name', 'Organization email', 'Description', 'Approximate number of users', 'Contact person name', 'Contact person email', 'Phone']) {
      expect(html).toContain(`>${label}<span aria-hidden="true" class="ml-0.5 text-status-rejected-fg">*</span>`)
    }
    expect(html).toMatch(/>Address<span aria-hidden="true" class="ml-0.5 text-status-rejected-fg">\*<\/span><\/legend>/)
  })

  it('keeps the hidden field for bots apart from the real Website', () => {
    expect(html.match(/name="website"/g)).toHaveLength(1)
    expect(html).toMatch(/<input[^>]*name="organizationWebsite"[^>]*>/)
  })
})

