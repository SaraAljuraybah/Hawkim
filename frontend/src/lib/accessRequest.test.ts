import { describe, expect, it } from 'vitest'
import { failureField, liveProblem, normalizePhone, REQUEST_ERROR_ORDER, requestProblems, reviewDetails, type RequestValues } from './accessRequest'
import type { AccessRequestView } from '../services/accessRequests'

const details = {
  organizationEmail: 'info@riyadhpharma.example', organizationAddress: 'King Fahd Road, Riyadh', organizationMapsUrl: '',
  organizationWebsite: '', organizationDescription: 'Makes medicines.',
}
const valid: RequestValues = {
  organization: 'Riyadh Pharma Co.', contactName: 'Lama Alotaibi', email: 'lama@riyadhpharma.example',
  phone: '05 1234 5678', approxUsers: '25', message: '', ...details,
}

describe('Request Hawkim form checks', () => {
  it('accepts Saudi mobile numbers in the usual ways and stores them as +9665XXXXXXXX', () => {
    for (const input of ['0512345678', '512345678', '+966512345678', '00966512345678', '+966 51 234 5678', '051-234-5678']) {
      expect(normalizePhone(input)).toBe('+966512345678')
    }
    for (const input of ['0112345678', '05123', '+971512345678', 'phone']) expect(normalizePhone(input)).toBeUndefined()
  })

  it('accepts a complete form, which has no Position (Admins have none)', () => {
    expect(requestProblems(valid)).toEqual({})
    expect(Object.keys(valid)).not.toContain('jobTitle')
  })

  it('names the problem of each field', () => {
    const problems = requestProblems({ ...valid, organization: ' ', email: 'lama', phone: '123', approxUsers: '2.5', message: 'x'.repeat(2001) })
    expect(problems).toEqual({ organization: 'required', email: 'email', phone: 'phone', approxUsers: 'approxUsers', message: 'tooLong' })
    expect(requestProblems({ ...valid, approxUsers: '0' }).approxUsers).toBe('approxUsers')
    expect(requestProblems({ ...valid, contactName: 'x'.repeat(101) }).contactName).toBe('tooLong')
  })
})

describe('Request Hawkim live checks (on leaving a field, and while its error shows)', () => {
  const filled: RequestValues = { organization: 'Org', contactName: 'Sara', email: 'sara@org.sa', phone: '+966512345678', approxUsers: '20', message: '', ...details }

  it('shows a wrong email, phone or number of users at once', () => {
    expect(liveProblem('email', { ...filled, email: 'sara@' })).toBe('email')
    expect(liveProblem('phone', { ...filled, phone: '+9665123' })).toBe('phone')
    expect(liveProblem('approxUsers', { ...filled, approxUsers: '0' })).toBe('approxUsers')
    expect(liveProblem('approxUsers', { ...filled, approxUsers: '2.5' })).toBe('approxUsers')
  })

  it('shows nothing once the value is valid', () => {
    for (const field of ['organization', 'contactName', 'email', 'phone', 'approxUsers', 'message'] as const) {
      expect(liveProblem(field, filled), field).toBeUndefined()
    }
  })

  it('leaves "required" to Send Request: an empty field shows nothing', () => {
    for (const field of ['organization', 'contactName', 'email', 'phone', 'organizationEmail', 'organizationDescription', 'approxUsers'] as const) {
      expect(requestProblems({ ...filled, [field]: '' })[field], field).toBe('required')
      expect(liveProblem(field, { ...filled, [field]: '' }), field).toBeUndefined()
    }
  })

  it('shows a wrong organization email, link or a value that is too long at once', () => {
    expect(liveProblem('organizationEmail', { ...filled, organizationEmail: 'info@' })).toBe('email')
    expect(liveProblem('organizationMapsUrl', { ...filled, organizationMapsUrl: 'maps.google.com' })).toBe('url')
    expect(liveProblem('organizationWebsite', { ...filled, organizationWebsite: 'http://org.sa' })).toBe('url')
    expect(liveProblem('organizationAddress', { ...filled, organizationAddress: 'a'.repeat(301) })).toBe('tooLong')
    expect(liveProblem('organizationDescription', { ...filled, organizationDescription: 'd'.repeat(1001) })).toBe('tooLong')
  })
})

describe('Request Hawkim: the organization’s details, with the Organization Profile’s rules', () => {
  it('needs an address or a Google Maps link (one is enough), as one problem for the group', () => {
    expect(requestProblems({ ...valid, organizationAddress: ' ', organizationMapsUrl: '' })).toEqual({ addressGroup: 'required' })
    expect(requestProblems({ ...valid, organizationAddress: '', organizationMapsUrl: 'https://maps.google.com/?q=riyadh' })).toEqual({})
    expect(requestProblems({ ...valid, organizationMapsUrl: 'https://maps.google.com/?q=riyadh' })).toEqual({})
  })

  it('leaves the website optional, and takes https:// links only', () => {
    expect(requestProblems({ ...valid, organizationWebsite: '' })).toEqual({})
    expect(requestProblems({ ...valid, organizationWebsite: 'https://riyadhpharma.example' })).toEqual({})
    expect(requestProblems({ ...valid, organizationWebsite: 'http://riyadhpharma.example' })).toEqual({ organizationWebsite: 'url' })
    expect(requestProblems({ ...valid, organizationMapsUrl: 'http://maps.google.com' })).toEqual({ organizationMapsUrl: 'url' })
  })

  it('has the same limits as the Organization Profile', () => {
    expect(requestProblems({ ...valid, organizationEmail: `${'e'.repeat(250)}@x.io` })).toEqual({ organizationEmail: 'tooLong' })
    expect(requestProblems({ ...valid, organizationAddress: 'a'.repeat(300) })).toEqual({})
    expect(requestProblems({ ...valid, organizationDescription: 'd'.repeat(1000) })).toEqual({})
    expect(requestProblems({ ...valid, organizationWebsite: `https://${'w'.repeat(2036)}.com` })).toEqual({})
    expect(requestProblems({ ...valid, organizationWebsite: `https://${'w'.repeat(2037)}.com` })).toEqual({ organizationWebsite: 'tooLong' })
  })

  it('puts the Address group before its two boxes, after the organization email (focus goes to the first problem)', () => {
    expect(REQUEST_ERROR_ORDER).toEqual([
      'organization', 'contactName', 'email', 'phone', 'organizationEmail', 'addressGroup', 'organizationAddress', 'organizationMapsUrl',
      'organizationWebsite', 'organizationDescription', 'approxUsers', 'message',
    ])
  })
})

describe('a refused Send Request', () => {
  it('puts "organization taken" on the Organization field (focus moves there)', () => {
    expect(failureField('organization-taken')).toEqual({ field: 'organization', error: 'organizationTaken' })
  })

  it('leaves every other refusal above the form', () => {
    for (const reason of ['invalid', 'too-many-requests', 'not-connected', 'failed']) expect(failureField(reason), reason).toBeUndefined()
  })
})

describe('a request on the review page', () => {
  const request: AccessRequestView = {
    organization: 'Riyadh Pharma', contactName: 'Lama Alotaibi', email: 'lama@riyadhpharma.example', phone: '+966512345678',
    approxUsers: 20, message: '', status: 'pending', createdAt: '2026-11-11T08:00:00Z', decidedAt: null, expired: false, accountExists: false,
  }
  const labels = (details: [string, string][]) => details.map(([label]) => label)

  it('lists no Position for a request without one', () => {
    expect(labels(reviewDetails(request))).toEqual([
      'Organization', 'Contact person', 'Contact person email', 'Phone', 'Organization email', 'Address', 'Google Maps link', 'Website',
      'Description', 'Approximate number of users', 'Message', 'Received',
    ])
    expect(labels(reviewDetails({ ...request, jobTitle: null }))).not.toContain('Position')
    expect(labels(reviewDetails({ ...request, jobTitle: '' }))).not.toContain('Position')
  })

  it('still lists the Position of a request sent before it was removed, after Contact person', () => {
    const details = reviewDetails({ ...request, jobTitle: 'QPPV' })
    expect(details[2]).toEqual(['Position', 'QPPV'])
  })

  it('lists the organization’s details of a new request', () => {
    const details = new Map(reviewDetails({
      ...request, organizationEmail: 'info@riyadhpharma.example', organizationAddress: 'King Fahd Road, Riyadh',
      organizationMapsUrl: 'https://maps.google.com/?q=riyadh', organizationWebsite: 'https://riyadhpharma.example', organizationDescription: 'Makes medicines.',
    }))
    expect(details.get('Contact person email')).toBe('lama@riyadhpharma.example')
    expect(details.get('Organization email')).toBe('info@riyadhpharma.example')
    expect(details.get('Address')).toBe('King Fahd Road, Riyadh')
    expect(details.get('Google Maps link')).toBe('https://maps.google.com/?q=riyadh')
    expect(details.get('Website')).toBe('https://riyadhpharma.example')
    expect(details.get('Description')).toBe('Makes medicines.')
  })

  it('shows "Not provided" for details a request doesn’t have (sent before the form asked, or optional and empty)', () => {
    const old = new Map(reviewDetails(request))
    for (const label of ['Organization email', 'Address', 'Google Maps link', 'Website', 'Description']) expect(old.get(label), label).toBe('Not provided')
    const partial = new Map(reviewDetails({ ...request, organizationAddress: 'King Fahd Road', organizationMapsUrl: null, organizationWebsite: '' }))
    expect(partial.get('Address')).toBe('King Fahd Road')
    expect(partial.get('Google Maps link')).toBe('Not provided')
    expect(partial.get('Website')).toBe('Not provided')
  })
})
