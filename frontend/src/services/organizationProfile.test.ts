import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_ORGANIZATION_PROFILE,
  fetchOrganizationProfile,
  OrganizationProfileError,
  organizationProfileProblems,
  saveOrganizationProfile,
  type OrganizationProfile,
} from './organizationProfile'
import { onOrganizationNameSaved } from './organizationSettings'

/*
 * Organization Profile as the browser reads and saves it. The rules are enforced and tested in the database
 * (supabase/tests/organization_profile.sql).
 */

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: () => ({ rpc }) }))
beforeEach(() => vi.clearAllMocks())

const valid: OrganizationProfile = {
  name: 'Riyadh Pharma', email: 'info@riyadh-pharma.test', description: 'Makes medicines.',
  address: 'King Fahd Road, Riyadh', mapsUrl: 'https://maps.google.com/?q=riyadh', website: 'https://riyadh-pharma.test',
}

describe('the Organization Profile checks', () => {
  it('accepts six valid values', () => {
    expect(organizationProfileProblems(valid)).toEqual({})
  })

  it('requires the name, the email and the description, and an address or a Google Maps link', () => {
    expect(organizationProfileProblems(EMPTY_ORGANIZATION_PROFILE)).toEqual({
      name: 'required', email: 'required', description: 'required', addressGroup: 'required',
    })
    expect(organizationProfileProblems({ ...valid, address: '   ', mapsUrl: ' ' })).toEqual({ addressGroup: 'required' })
  })

  it('takes only one of the address and the Google Maps link, and no website', () => {
    expect(organizationProfileProblems({ ...valid, address: '   ' })).toEqual({})
    expect(organizationProfileProblems({ ...valid, mapsUrl: '' })).toEqual({})
    expect(organizationProfileProblems({ ...valid, website: '' })).toEqual({})
  })

  it('rejects an invalid email and links that do not start with https://', () => {
    expect(organizationProfileProblems({ ...valid, email: 'info@' })).toEqual({ email: 'email' })
    expect(organizationProfileProblems({ ...valid, mapsUrl: 'maps.google.com' })).toEqual({ mapsUrl: 'url' })
    expect(organizationProfileProblems({ ...valid, website: 'ftp://riyadh-pharma.test' })).toEqual({ website: 'url' })
    expect(organizationProfileProblems({ ...valid, website: 'https://riyadh pharma.test' })).toEqual({ website: 'url' })
    expect(organizationProfileProblems({ ...valid, mapsUrl: 'http://maps.app.goo.gl/abc' })).toEqual({ mapsUrl: 'url' })
    expect(organizationProfileProblems({ ...valid, website: 'http://riyadh-pharma.test' })).toEqual({ website: 'url' })
    expect(organizationProfileProblems({ ...valid, mapsUrl: 'HTTPS://maps.app.goo.gl/abc' })).toEqual({})
  })

  it('rejects values that are too long', () => {
    expect(organizationProfileProblems({ ...valid, name: 'n'.repeat(201) })).toEqual({ name: 'tooLong' })
    expect(organizationProfileProblems({ ...valid, description: 'd'.repeat(1001) })).toEqual({ description: 'tooLong' })
  })
})

describe('loading the profile', () => {
  it('reads get_organization_profile; nothing saved yet is empty values, never invented ones', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(fetchOrganizationProfile()).resolves.toEqual(EMPTY_ORGANIZATION_PROFILE)
    rpc.mockResolvedValue({ data: { name: 'Old Name', email: null, description: null, address: null, mapsUrl: null, website: null }, error: null })
    await expect(fetchOrganizationProfile()).resolves.toEqual({ ...EMPTY_ORGANIZATION_PROFILE, name: 'Old Name' })
    expect(rpc).toHaveBeenCalledWith('get_organization_profile')
  })

  it('fails when it can not be read', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(fetchOrganizationProfile()).rejects.toEqual(new OrganizationProfileError('forbidden'))
    rpc.mockResolvedValue({ data: 'unexpected', error: null })
    await expect(fetchOrganizationProfile()).rejects.toEqual(new OrganizationProfileError('failed'))
  })
})

describe('saving the profile', () => {
  it('sends each value to its own parameter, trimmed, and returns what was stored', async () => {
    rpc.mockResolvedValue({ data: { ...valid, updatedAt: '2026-11-11T10:00:00Z' }, error: null })
    await expect(saveOrganizationProfile({ ...valid, name: '  Riyadh Pharma  ' })).resolves.toEqual(valid)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('save_organization_profile', {
      p_name: 'Riyadh Pharma', p_email: valid.email, p_description: valid.description,
      p_address: valid.address, p_maps_url: valid.mapsUrl, p_website: valid.website,
    })
  })

  it('tells the top bar about the saved name', async () => {
    const seen: string[] = []
    const stop = onOrganizationNameSaved((name) => seen.push(name))
    rpc.mockResolvedValue({ data: { ...valid, name: 'Riyadh Pharma Group' }, error: null })
    await saveOrganizationProfile({ ...valid, name: 'Riyadh Pharma Group' })
    stop()
    await saveOrganizationProfile(valid)
    expect(seen).toEqual(['Riyadh Pharma Group'])
  })

  it.each([
    [{ code: '42501', hint: 'super-admin-required' }, 'forbidden'],
    [{ code: '22023', hint: 'email' }, 'invalid'],
    [{ code: 'XX000' }, 'failed'],
  ] as const)('explains a refusal (%j)', async (error, reason) => {
    rpc.mockResolvedValue({ data: null, error })
    await expect(saveOrganizationProfile(valid)).rejects.toEqual(new OrganizationProfileError(reason))
  })
})
