import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { requestHawkimEn } from '../content/accessRequest.en'
import { submitAccessRequest } from './accessRequests'

const invoke = vi.fn()
vi.mock('./supabase', () => ({ supabase: () => ({ functions: { invoke } }) }))

const values = {
  organization: '  Riyadh Pharma ', contactName: 'Lama', email: 'lama@riyadhpharma.example',
  phone: '+966512345678', approxUsers: '25', message: '',
  organizationEmail: ' info@riyadhpharma.example ', organizationAddress: ' King Fahd Road ', organizationMapsUrl: '',
  organizationWebsite: ' https://riyadhpharma.example ', organizationDescription: ' Makes medicines. ',
}
/** The access-requests Edge Function refusing with this status and error code. */
const refused = (status: number, error: string) =>
  invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({ error }), { status })) })

beforeEach(() => vi.clearAllMocks())

describe('sending Request Hawkim', () => {
  it('sends the trimmed form and succeeds', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    expect(await submitAccessRequest(values)).toEqual({ ok: true })
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'submit', organization: 'Riyadh Pharma', phone: '+966512345678', approxUsers: 25 })
  })

  it('sends the organization’s details trimmed, the Website as organizationWebsite (website is the field for bots)', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await submitAccessRequest(values, '')
    expect(invoke.mock.calls[0][1].body).toMatchObject({
      organizationEmail: 'info@riyadhpharma.example', organizationAddress: 'King Fahd Road', organizationMapsUrl: '',
      organizationWebsite: 'https://riyadhpharma.example', organizationDescription: 'Makes medicines.', website: '',
    })
  })

  it('tells when the organization name is already taken (409 organization_taken)', async () => {
    refused(409, 'organization_taken')
    expect(await submitAccessRequest(values)).toEqual({ ok: false, reason: 'organization-taken' })
    expect(requestHawkimEn.errors.organizationTaken).toBe('An organization with this name already exists.')
  })

  it('keeps the other refusals as they were', async () => {
    refused(400, 'invalid')
    expect(await submitAccessRequest(values)).toEqual({ ok: false, reason: 'invalid' })
    refused(429, 'too_many_requests')
    expect(await submitAccessRequest(values)).toEqual({ ok: false, reason: 'too-many-requests' })
    refused(500, 'failed')
    expect(await submitAccessRequest(values)).toEqual({ ok: false, reason: 'failed' })
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError('offline') })
    expect(await submitAccessRequest(values)).toEqual({ ok: false, reason: 'not-connected' })
  })
})
