/*
 * The rules for an organization's details, shared by the Organization Profile (admin portal) and the
 * Request Hawkim form, as the database checks them (save_organization_profile, submit_access_request).
 * Whether a value is required is up to each form.
 */

import type { OrganizationProfileField } from '../content/types'

/** The most each value may have (trimmed). */
export const ORGANIZATION_DETAIL_MAX: Record<OrganizationProfileField, number> = {
  name: 200, email: 254, description: 1000, address: 300, mapsUrl: 2048, website: 2048,
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** An http(s) link with a host that has a dot and no spaces (as the database checks). */
const URL_PATTERN = /^https?:\/\/[^\s/?#]+\.[^\s]*$/i

/** What can be wrong with a value that was given: not an email, not a link, or too long. */
export type OrganizationDetailProblem = 'email' | 'url' | 'tooLong'

/** A given value's problem (trimmed), or undefined; an empty value has none here. */
export function organizationDetailProblem(field: OrganizationProfileField, value: string): OrganizationDetailProblem | undefined {
  const text = value.trim()
  if (!text) return undefined
  if (text.length > ORGANIZATION_DETAIL_MAX[field]) return 'tooLong'
  if (field === 'email' && !EMAIL.test(text)) return 'email'
  if ((field === 'mapsUrl' || field === 'website') && !URL_PATTERN.test(text)) return 'url'
  return undefined
}
