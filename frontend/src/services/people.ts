/*
 * People and departments from the database (tables profiles, user_roles and
 * departments; see supabase/migrations/). Rows are turned into the app's existing
 * User and Department types, so screens don't change. Row level security lets only
 * a signed-in person with an active profile read them; an admin changes a user through
 * save_user, which checks that and the rules in the database.
 */

import type { Department, DepartmentId, Permission, User } from '../data/mock/types'
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
export interface UserChanges {
  name: string
  phone: string
  position: string
  departmentId: DepartmentId
  permissions: Permission[]
}

/** Why a user's changes could not be saved. */
export type SaveUserFailure =
  | 'forbidden' | 'not-found' | 'conflict' | 'invalid' | 'self-admin' | 'last-admin' | 'admin-exclusive'
  | 'approver-quality' | 'department-unavailable' | 'permission-in-use' | 'failed'

/** A permission that can't be removed, and on how many SOPs it's used (their titles aren't sent: an admin may not see them). */
export interface PermissionInUse {
  permission: Permission
  count: number
}

export class SaveUserError extends Error {
  readonly reason: SaveUserFailure
  readonly inUse: PermissionInUse[]
  constructor(reason: SaveUserFailure, inUse: PermissionInUse[] = []) {
    super(`The user's changes were not saved (${reason})`)
    this.reason = reason
    this.inUse = inUse
  }
}

const SAVE_USER_HINTS: SaveUserFailure[] = ['invalid', 'self-admin', 'last-admin', 'admin-exclusive', 'approver-quality', 'department-unavailable', 'permission-in-use']

function saveUserError(error: { code?: string; hint?: string | null; details?: string | null }): SaveUserError {
  const hinted = SAVE_USER_HINTS.find((reason) => reason === error.hint)
  if (hinted === 'permission-in-use') {
    // "author:2,reviewer:1"
    const inUse = (error.details ?? '').split(',').flatMap((item) => {
      const [permission, count] = item.split(':')
      return PERMISSIONS.includes(permission as Permission) && Number(count) > 0 ? [{ permission: permission as Permission, count: Number(count) }] : []
    })
    return new SaveUserError(hinted, inUse)
  }
  if (hinted) return new SaveUserError(hinted)
  // PGRST30x: the session's token has expired or isn't valid.
  if (error.code === '42501' || error.code?.startsWith('PGRST30')) return new SaveUserError('forbidden')
  if (error.code === 'P0002') return new SaveUserError('not-found')
  if (error.code === '40001') return new SaveUserError('conflict')
  // A rule of the database's triggers, or update_user_details refusing the details.
  if (error.code === '23514') return new SaveUserError('invalid')
  return new SaveUserError('failed')
}

/**
 * Saves a user's name, phone, position, department and permissions, all or nothing; `expected` is what
 * the form loaded, so another admin's change isn't overwritten. Returns them as saved, with the
 * initials. Throws a SaveUserError.
 */
export async function saveUser(
  userId: string,
  changes: UserChanges,
  expected: { departmentId: DepartmentId; permissions: Permission[] },
): Promise<UserChanges & { initials: string }> {
  let response
  try {
    response = await supabase().rpc('save_user', {
      p_user_id: userId,
      p_full_name: changes.name,
      p_phone: changes.phone,
      p_position: changes.position,
      p_department_id: changes.departmentId,
      p_roles: changes.permissions,
      p_expected_department_id: expected.departmentId,
      p_expected_roles: expected.permissions,
    })
  } catch {
    throw new SaveUserError('failed')
  }
  if (response.error) throw saveUserError(response.error)
  const saved = response.data as { name?: unknown; initials?: unknown; phone?: unknown; position?: unknown; departmentId?: unknown; permissions?: unknown } | null
  if (typeof saved?.name !== 'string' || typeof saved.initials !== 'string' || typeof saved.phone !== 'string'
    || typeof saved.position !== 'string' || typeof saved.departmentId !== 'string' || !Array.isArray(saved.permissions)) {
    throw new SaveUserError('failed')
  }
  const permissions = saved.permissions as Permission[]
  return {
    name: saved.name,
    initials: saved.initials,
    phone: saved.phone,
    position: saved.position,
    departmentId: saved.departmentId,
    // In the usual display order.
    permissions: PERMISSIONS.filter((permission) => permissions.includes(permission)),
  }
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
