import { describe, expect, it } from 'vitest'
import { normalizePhone, requestProblems, type RequestValues } from './accessRequest'

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
