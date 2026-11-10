import { describe, expect, it } from 'vitest'
import { failureField, liveProblem, normalizePhone, requestProblems, type RequestValues } from './accessRequest'

const valid: RequestValues = {
  organization: 'Riyadh Pharma Co.', contactName: 'Lama Alotaibi', jobTitle: 'QPPV', email: 'lama@riyadhpharma.example',
  phone: '05 1234 5678', approxUsers: '25', message: '',
}

describe('Request Hawkim form checks', () => {
  it('accepts Saudi mobile numbers in the usual ways and stores them as +9665XXXXXXXX', () => {
    for (const input of ['0512345678', '512345678', '+966512345678', '00966512345678', '+966 51 234 5678', '051-234-5678']) {
      expect(normalizePhone(input)).toBe('+966512345678')
    }
    for (const input of ['0112345678', '05123', '+971512345678', 'phone']) expect(normalizePhone(input)).toBeUndefined()
  })

  it('accepts a complete form', () => {
    expect(requestProblems(valid)).toEqual({})
  })

  it('names the problem of each field', () => {
    const problems = requestProblems({ ...valid, organization: ' ', email: 'lama', phone: '123', approxUsers: '2.5', message: 'x'.repeat(2001) })
    expect(problems).toEqual({ organization: 'required', email: 'email', phone: 'phone', approxUsers: 'approxUsers', message: 'tooLong' })
    expect(requestProblems({ ...valid, approxUsers: '0' }).approxUsers).toBe('approxUsers')
    expect(requestProblems({ ...valid, contactName: 'x'.repeat(101) }).contactName).toBe('tooLong')
  })
})

describe('Request Hawkim live checks (on leaving a field, and while its error shows)', () => {
  const filled: RequestValues = { organization: 'Org', contactName: 'Sara', jobTitle: 'Lead', email: 'sara@org.sa', phone: '+966512345678', approxUsers: '20', message: '' }

  it('shows a wrong email, phone or number of users at once', () => {
    expect(liveProblem('email', { ...filled, email: 'sara@' })).toBe('email')
    expect(liveProblem('phone', { ...filled, phone: '+9665123' })).toBe('phone')
    expect(liveProblem('approxUsers', { ...filled, approxUsers: '0' })).toBe('approxUsers')
    expect(liveProblem('approxUsers', { ...filled, approxUsers: '2.5' })).toBe('approxUsers')
  })

  it('shows nothing once the value is valid', () => {
    for (const field of ['organization', 'contactName', 'jobTitle', 'email', 'phone', 'approxUsers', 'message'] as const) {
      expect(liveProblem(field, filled), field).toBeUndefined()
    }
  })

  it('leaves "required" to Send Request: an empty field shows nothing', () => {
    for (const field of ['organization', 'contactName', 'jobTitle', 'email', 'phone', 'approxUsers'] as const) {
      expect(requestProblems({ ...filled, [field]: '' })[field], field).toBe('required')
      expect(liveProblem(field, { ...filled, [field]: '' }), field).toBeUndefined()
    }
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
