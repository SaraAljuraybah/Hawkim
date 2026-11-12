import type { OrganizationProfileField } from '../content/types'
import { ORGANIZATION_DETAIL_MAX, organizationDetailProblem, type OrganizationDetailProblem } from '../lib/organizationDetails'
import { notifyOrganizationName } from './organizationSettings'
import { supabase } from './supabase'

/** The organization's details (Organization Profile). A value not saved yet is ''. */
export type OrganizationProfile = Record<OrganizationProfileField, string>

export const ORGANIZATION_PROFILE_FIELDS: readonly OrganizationProfileField[] = ['name', 'email', 'description', 'address', 'mapsUrl', 'website']

/** The most each value may have; the database allows the same (save_organization_profile). */
export const ORGANIZATION_PROFILE_MAX = ORGANIZATION_DETAIL_MAX

export const EMPTY_ORGANIZATION_PROFILE: OrganizationProfile = { name: '', email: '', description: '', address: '', mapsUrl: '', website: '' }

/** What can be wrong with a value: missing, not an email, not a link, or too long. */
export type OrganizationProfileProblem = 'required' | OrganizationDetailProblem

/**
 * Every value's problem (trimmed), as save_organization_profile checks them: all six are required; the email
 * must look like an address; the Google Maps link and the website must be http(s) links; none may be too long
 * (the shared rules in lib/organizationDetails.ts).
 */
export function organizationProfileProblems(values: OrganizationProfile): Partial<Record<OrganizationProfileField, OrganizationProfileProblem>> {
  const problems: Partial<Record<OrganizationProfileField, OrganizationProfileProblem>> = {}
  for (const field of ORGANIZATION_PROFILE_FIELDS) {
    const problem = values[field].trim() ? organizationDetailProblem(field, values[field]) : 'required'
    if (problem) problems[field] = problem
  }
  return problems
}

/** Why saving was refused: not the Super Admin, a value the server refused, or anything else. */
export type OrganizationProfileFailure = 'forbidden' | 'invalid' | 'failed'

export class OrganizationProfileError extends Error {
  readonly reason: OrganizationProfileFailure
  constructor(reason: OrganizationProfileFailure) {
    super(`The organization profile was not saved (${reason})`)
    this.reason = reason
  }
}

const textOf = (value: unknown) => (typeof value === 'string' ? value : '')

/** The stored profile as shown ('' for a value not saved yet). */
function toProfile(data: unknown): OrganizationProfile {
  if (data === null) return { ...EMPTY_ORGANIZATION_PROFILE }
  if (typeof data !== 'object' || Array.isArray(data)) throw new OrganizationProfileError('failed')
  const row = data as Record<string, unknown>
  return {
    name: textOf(row.name), email: textOf(row.email), description: textOf(row.description),
    address: textOf(row.address), mapsUrl: textOf(row.mapsUrl), website: textOf(row.website),
  }
}

/** The organization's details from the database (get_organization_profile; active Admins). Throws if they can't be read. */
export async function fetchOrganizationProfile(): Promise<OrganizationProfile> {
  const { data, error } = await supabase().rpc('get_organization_profile')
  if (error) throw new OrganizationProfileError(error.code === '42501' ? 'forbidden' : 'failed')
  return toProfile(data)
}

/**
 * Saves all six values (trimmed) through save_organization_profile (the Super Admin only; the server checks
 * them again) and returns them as stored. Each value goes to its own column: a new name changes nothing else.
 * The top bar's name follows a saved name. Throws an OrganizationProfileError.
 */
export async function saveOrganizationProfile(values: OrganizationProfile): Promise<OrganizationProfile> {
  let response
  try {
    response = await supabase().rpc('save_organization_profile', {
      p_name: values.name.trim(), p_email: values.email.trim(), p_description: values.description.trim(),
      p_address: values.address.trim(), p_maps_url: values.mapsUrl.trim(), p_website: values.website.trim(),
    })
  } catch {
    throw new OrganizationProfileError('failed')
  }
  const { data, error } = response
  if (error) {
    if (error.code === '42501' || error.code?.startsWith('PGRST30')) throw new OrganizationProfileError('forbidden')
    if (error.code === '22023' || error.code === '23514') throw new OrganizationProfileError('invalid')
    throw new OrganizationProfileError('failed')
  }
  const saved = toProfile(data)
  notifyOrganizationName(saved.name)
  return saved
}
