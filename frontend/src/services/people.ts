/*
 * People and departments from the database (tables profiles, user_roles and
 * departments; see supabase/migrations/). Rows are turned into the app's existing
 * User and Department types, so screens don't change. Row level security lets only
 * a signed-in person with an active profile read them; an admin changes a user's name,
 * phone and position through update_user_details, which checks that in the database.
 */

import type { Department, Permission, User } from '../data/mock/types'
import { PERMISSIONS } from '../lib/userAdmin'
import { supabase } from './supabase'

/** The columns read for a person, with their roles. */
const PROFILE_COLUMNS = 'id, full_name, email, initials, department_id, phone, position, deleted_at, user_roles(role)'
// The division comes from departments.division_id (managed in Divisions & Departments) with its name,
// through the departments_division_id_fkey relationship; every active user can read both.
const DEPARTMENT_COLUMNS = 'id, name, initials, description, is_quality, removed_at, requires_compliance_check, division_id, division:divisions(name)'

export interface ProfileRow {
  id: string
  full_name: string
  email: string
  initials: string
  department_id: string
  /** "+9665XXXXXXXX"; null on profiles added before it was required. */
  phone: string | null
  /** Job title; null on profiles added before it was required. */
  position: string | null
  deleted_at: string | null
  user_roles: { role: Permission }[]
}

export interface DepartmentRow {
  id: string
  name: string
  initials: string
  description: string
  is_quality: boolean
  removed_at: string | null
  requires_compliance_check: boolean
  division_id?: string | null
  division?: { name: string } | null
}

/** A profile row as a User: roles become permissions, in the usual display order. */
export function toUser(row: ProfileRow): User {
  const roles = row.user_roles.map((item) => item.role)
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    initials: row.initials,
    departmentId: row.department_id,
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.position ? { position: row.position } : {}),
    permissions: PERMISSIONS.filter((permission) => roles.includes(permission)),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  }
}

/**
 * The signed-in person's profile, or null when they have none or it was ended
 * (row level security then shows them nothing). Throws if the database can't be reached.
 */
export async function fetchProfile(userId: string): Promise<User | null> {
  const { data, error } = await supabase().from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as ProfileRow | null
  return row && !row.deleted_at ? toUser(row) : null
}

/** Everyone with a profile, ended ones included (their names stay on history), by name. */
export async function fetchPeople(): Promise<User[]> {
  const { data, error } = await supabase().from('profiles').select(PROFILE_COLUMNS).order('full_name')
  if (error) throw new Error(error.message)
  return (data as ProfileRow[]).map(toUser)
}

/** What an admin saves for a user. `phone` is as stored ("+9665XXXXXXXX"). */
export interface UserDetails {
  name: string
  phone: string
  position: string
}

/** Why a user's details could not be saved. */
export type UserDetailsFailure = 'forbidden' | 'not-found' | 'invalid' | 'failed'

export class UserDetailsError extends Error {
  readonly reason: UserDetailsFailure
  constructor(reason: UserDetailsFailure) {
    super(`The user's details were not saved (${reason})`)
    this.reason = reason
  }
}

function detailsFailure(code: string | undefined): UserDetailsFailure {
  // PGRST30x: the session's token has expired or isn't valid.
  if (code === '42501' || code?.startsWith('PGRST30')) return 'forbidden'
  if (code === 'P0002') return 'not-found'
  if (code === '23514') return 'invalid'
  return 'failed'
}

/** Saves a user's name, phone and position; returns them as saved, with the initials. Throws a UserDetailsError. */
export async function updateUserDetails(userId: string, details: UserDetails): Promise<UserDetails & { initials: string }> {
  let response
  try {
    response = await supabase().rpc('update_user_details', {
      p_user_id: userId, p_full_name: details.name, p_phone: details.phone, p_position: details.position,
    })
  } catch {
    throw new UserDetailsError('failed')
  }
  if (response.error) throw new UserDetailsError(detailsFailure(response.error.code))
  const saved = response.data as { name?: unknown; initials?: unknown; phone?: unknown; position?: unknown } | null
  if (typeof saved?.name !== 'string' || typeof saved.initials !== 'string' || typeof saved.phone !== 'string' || typeof saved.position !== 'string') {
    throw new UserDetailsError('failed')
  }
  return { name: saved.name, initials: saved.initials, phone: saved.phone, position: saved.position }
}

/** A department row as a Department. */
export function toDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    description: row.description,
    ...(row.is_quality ? { isQuality: true } : {}),
    ...(row.removed_at ? { removedAt: row.removed_at } : {}),
    ...(row.requires_compliance_check ? { requiresComplianceCheck: true } : {}),
    ...(row.division_id ? { divisionId: row.division_id, divisionName: row.division?.name ?? row.division_id } : {}),
  }
}

/** Every department, removed ones included (their names stay on old records), by name. */
export async function fetchDepartments(): Promise<Department[]> {
  const { data, error } = await supabase().from('departments').select(DEPARTMENT_COLUMNS).order('name')
  if (error) throw new Error(error.message)
  return (data as unknown as DepartmentRow[]).map(toDepartment)
}
