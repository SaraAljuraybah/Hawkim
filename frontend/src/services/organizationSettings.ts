import { organizationAdminEn } from '../content/organizationAdmin.en'
import { supabase } from './supabase'

const text = organizationAdminEn.organizationName

/** The most an organization name may have; the database allows the same (organization_settings). */
export const ORGANIZATION_NAME_MAX = 200

/** What's wrong with a name typed in the dialog ('required' or 'tooLong'), or undefined when it can be saved. */
export function organizationNameProblem(value: string): 'required' | 'tooLong' | undefined {
  const trimmed = value.trim()
  return !trimmed ? 'required' : trimmed.length > ORGANIZATION_NAME_MAX ? 'tooLong' : undefined
}

/** A refusal of set_organization_name (migration 20261111140000), as what the person should do next. */
function saveError(error: { code?: string }): Error {
  if (error.code === '42501') return new Error(text.forbidden)
  if (error.code === '22023') return new Error(text.invalid)
  return new Error(text.failed)
}

/** The organization's name, or null when none is saved yet. Throws if it can't be read. */
export async function fetchOrganizationName(): Promise<string | null> {
  const { data, error } = await supabase().rpc('get_organization_name')
  if (error) throw new Error(text.failed)
  if (data !== null && typeof data !== 'string') throw new Error(text.failed)
  return data
}

/** Saves the organization's name (the Super Admin only; the server checks) and returns it as stored. */
export async function saveOrganizationName(name: string): Promise<string> {
  const { data, error } = await supabase().rpc('set_organization_name', { p_name: name })
  if (error) throw saveError(error)
  if (typeof data !== 'string') throw new Error(text.failed)
  return data
}
