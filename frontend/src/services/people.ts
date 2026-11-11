/*
 * People and departments from the database (tables profiles, user_roles and
 * departments; see supabase/migrations/). Rows are turned into the app's existing
 * User and Department types, so screens don't change. Row level security lets only
 * a signed-in person with an active profile read them; an admin changes a user through
 * save_user, adds (or reactivates) one through the add-user Edge Function, changes their email through the
 * update-user-email Edge Function and deactivates a staff member through deactivate_staff, which check
 * that and the rules on the server.
 */

import { FunctionsHttpError } from '@supabase/supabase-js'
import type { Department, DepartmentId, Permission, User } from '../data/mock/types'
import { PERMISSIONS } from '../lib/userAdmin'
import { supabase } from './supabase'

/** The columns read for a person, with their roles. */
const PROFILE_COLUMNS = 'id, full_name, email, initials, department_id, phone, position, deleted_at, user_roles(role)'
// The division comes from departments.division_id (managed in Divisions and Departments) with its name,
// through the departments_division_id_fkey relationship; every active user can read both.
const DEPARTMENT_COLUMNS = 'id, name, initials, description, is_quality, removed_at, requires_compliance_check, division_id, division:divisions(name)'

export interface ProfileRow {
  id: string
  full_name: string
  email: string
  initials: string
  /** Null for a System Admin, who has no department. */
  department_id: string | null
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
    // '' (no department) for a System Admin without one.
    departmentId: row.department_id ?? '',
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

/**
 * What an admin saves for a user. `phone` is as stored ("+9665XXXXXXXX"). A System Admin has no
 * department or position (null); the database keeps theirs as they are.
 */
export interface UserChanges {
  name: string
  phone: string
  position: string | null
  departmentId: DepartmentId | null
  permissions: Permission[]
}

/** Why a user's changes could not be saved. */
export type SaveUserFailure =
  | 'forbidden' | 'not-found' | 'conflict' | 'invalid' | 'self-admin' | 'last-admin' | 'admin-exclusive'
  | 'approver-quality' | 'department-unavailable' | 'department-required' | 'permission-in-use'
  | 'department-transfer-blocked' | 'failed'

/** A permission that can't be removed, and on how many SOPs it's used (their titles aren't sent: an admin may not see them). */
export interface PermissionInUse {
  permission: Permission
  count: number
}

export class SaveUserError extends Error {
  readonly reason: SaveUserFailure
  readonly inUse: PermissionInUse[]
  /** For 'department-transfer-blocked': how many SOPs are still in progress (0 when not known). */
  readonly blockingSops: number
  constructor(reason: SaveUserFailure, inUse: PermissionInUse[] = [], blockingSops = 0) {
    super(`The user's changes were not saved (${reason})`)
    this.reason = reason
    this.inUse = inUse
    this.blockingSops = blockingSops
  }
}

const SAVE_USER_HINTS: SaveUserFailure[] = ['invalid', 'self-admin', 'last-admin', 'admin-exclusive', 'approver-quality', 'department-unavailable', 'department-required', 'permission-in-use', 'department-transfer-blocked']

/** "total:3,author:1,reviewer:2" → 3. */
function blockingTotal(details: string | null | undefined): number {
  const total = Number((details ?? '').split(',').find((item) => item.startsWith('total:'))?.slice('total:'.length))
  return Number.isInteger(total) && total > 0 ? total : 0
}

/** "author:2,reviewer:1" as a list. */
function permissionsInUse(details: string | null | undefined): PermissionInUse[] {
  return (details ?? '').split(',').flatMap((item) => {
    const [permission, count] = item.split(':')
    return PERMISSIONS.includes(permission as Permission) && Number(count) > 0 ? [{ permission: permission as Permission, count: Number(count) }] : []
  })
}

function saveUserError(error: { code?: string; hint?: string | null; details?: string | null }): SaveUserError {
  const hinted = SAVE_USER_HINTS.find((reason) => reason === error.hint)
  if (hinted === 'permission-in-use') return new SaveUserError(hinted, permissionsInUse(error.details))
  if (hinted === 'department-transfer-blocked') return new SaveUserError(hinted, [], blockingTotal(error.details))
  if (hinted) return new SaveUserError(hinted)
  // PGRST30x: the session's token has expired or isn't valid.
  if (error.code === '42501' || error.code?.startsWith('PGRST30')) return new SaveUserError('forbidden')
  if (error.code === 'P0002') return new SaveUserError('not-found')
  // 'conflict' hint: a stale save (20261112120000); 40001: the same, from a database without that migration.
  if (error.hint === 'conflict' || error.code === '40001') return new SaveUserError('conflict')
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
  expected: { departmentId: DepartmentId | null; permissions: Permission[] },
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
  const textOrNull = (value: unknown) => typeof value === 'string' || value === null
  if (typeof saved?.name !== 'string' || typeof saved.initials !== 'string' || typeof saved.phone !== 'string'
    || !textOrNull(saved.position) || !textOrNull(saved.departmentId) || !Array.isArray(saved.permissions)) {
    throw new SaveUserError('failed')
  }
  const permissions = saved.permissions as Permission[]
  return {
    name: saved.name,
    initials: saved.initials,
    phone: saved.phone,
    position: saved.position as string | null,
    departmentId: saved.departmentId as string | null,
    // In the usual display order.
    permissions: PERMISSIONS.filter((permission) => permissions.includes(permission)),
  }
}

/** Why a staff member's email could not be changed. */
export type ChangeEmailFailure = 'forbidden' | 'not-found' | 'email-taken' | 'invalid' | 'account-failed' | 'failed'

export class ChangeEmailError extends Error {
  readonly reason: ChangeEmailFailure
  constructor(reason: ChangeEmailFailure) {
    super(`The email was not changed (${reason})`)
    this.reason = reason
  }
}

const CHANGE_EMAIL_FAILURES: ChangeEmailFailure[] = ['not-found', 'email-taken', 'invalid', 'account-failed']

async function changeEmailError(error: unknown): Promise<ChangeEmailError> {
  if (!(error instanceof FunctionsHttpError)) return new ChangeEmailError('failed')
  const response = error.context as Response
  const payload = (await response.json().catch(() => ({}))) as { errorCode?: string }
  if (response.status === 401 || response.status === 403) return new ChangeEmailError('forbidden')
  return new ChangeEmailError(CHANGE_EMAIL_FAILURES.find((item) => item === payload.errorCode) ?? 'failed')
}

/**
 * Changes a staff member's email through the update-user-email Edge Function: their sign-in account
 * and their profile together, so they keep signing in with the email shown. Returns it as stored.
 * Throws a ChangeEmailError.
 */
export async function changeUserEmail(userId: string, email: string): Promise<string> {
  let response
  try {
    response = await supabase().functions.invoke('update-user-email', { body: { userId, email: email.trim().toLowerCase() } })
  } catch (error) {
    throw await changeEmailError(error)
  }
  if (response.error) throw await changeEmailError(response.error)
  const saved = (response.data as { email?: unknown } | null)?.email
  if (typeof saved !== 'string') throw new ChangeEmailError('failed')
  return saved
}

/** What an admin enters to add a user. `phone` is as stored ("+9665XXXXXXXX"). */
export type NewUserDetails = UserChanges & { email: string }

/** Why a user could not be added. */
export type AddUserFailure =
  | 'forbidden' | 'email-taken' | 'invalid' | 'admin-exclusive' | 'approver-quality' | 'department-unavailable'
  | 'permission-in-use' | 'account-failed' | 'account-blocked' | 'admin-managed-separately' | 'invitation-failed' | 'failed'

export class AddUserError extends Error {
  readonly reason: AddUserFailure
  readonly inUse: PermissionInUse[]
  constructor(reason: AddUserFailure, inUse: PermissionInUse[] = []) {
    super(`The user was not added (${reason})`)
    this.reason = reason
    this.inUse = inUse
  }
}

const ADD_USER_FAILURES: AddUserFailure[] = [
  'email-taken', 'invalid', 'admin-exclusive', 'approver-quality', 'department-unavailable', 'permission-in-use', 'account-failed', 'account-blocked',
  'admin-managed-separately', 'invitation-failed',
]

async function addUserError(error: unknown): Promise<AddUserError> {
  if (!(error instanceof FunctionsHttpError)) return new AddUserError('failed')
  const response = error.context as Response
  const payload = (await response.json().catch(() => ({}))) as { errorCode?: string; inUse?: string }
  // Refused by the platform (no errorCode) or the function: the session has expired, or isn't an admin's.
  if (response.status === 401 || response.status === 403) return new AddUserError('forbidden')
  const reason = ADD_USER_FAILURES.find((item) => item === payload.errorCode) ?? 'failed'
  return new AddUserError(reason, reason === 'permission-in-use' ? permissionsInUse(payload.inUse) : [])
}

/**
 * Adds a user through the add-user Edge Function: a real sign-in account, their profile and permissions,
 * and an invitation email. `emailSent` is false when only the email failed: the user was added.
 * `reactivated`: the email was a deactivated staff member's, who is active again (the same account and
 * profile, with these details) with a new invitation; if it couldn't be sent they stay deactivated
 * ('invitation-failed'). Throws an AddUserError.
 */
export async function addUserAccount(details: NewUserDetails): Promise<{ user: User; emailSent: boolean; reactivated: boolean }> {
  let response
  try {
    response = await supabase().functions.invoke('add-user', { body: details })
  } catch (error) {
    throw await addUserError(error)
  }
  if (response.error) throw await addUserError(response.error)
  const data = response.data as { user?: Record<string, unknown>; emailSent?: unknown } | null
  const saved = data?.user
  const textOrNull = (value: unknown) => typeof value === 'string' || value === null
  if (typeof saved?.id !== 'string' || typeof saved.email !== 'string' || typeof saved.name !== 'string' || typeof saved.initials !== 'string'
    || typeof saved.phone !== 'string' || !textOrNull(saved.position) || !textOrNull(saved.departmentId) || !Array.isArray(saved.permissions)) {
    throw new AddUserError('failed')
  }
  const permissions = saved.permissions as Permission[]
  return {
    user: {
      id: saved.id,
      name: saved.name,
      email: saved.email,
      initials: saved.initials,
      // A System Admin has no department or position.
      departmentId: (saved.departmentId as string | null) ?? '',
      phone: saved.phone,
      ...(typeof saved.position === 'string' ? { position: saved.position } : {}),
      permissions: PERMISSIONS.filter((permission) => permissions.includes(permission)),
    },
    emailSent: data?.emailSent === true,
    reactivated: saved.reactivated === true,
  }
}

/** Why a staff member could not be deactivated. */
export type DeactivateStaffFailure =
  | 'forbidden' | 'not-found' | 'self-delete' | 'admin-managed-separately' | 'responsibilities-in-progress' | 'failed'

export class DeactivateStaffError extends Error {
  readonly reason: DeactivateStaffFailure
  /** For 'responsibilities-in-progress': how many SOPs are still in progress (0 when not known). */
  readonly blockingSops: number
  constructor(reason: DeactivateStaffFailure, blockingSops = 0) {
    super(`The staff member was not deactivated (${reason})`)
    this.reason = reason
    this.blockingSops = blockingSops
  }
}

const DEACTIVATE_HINTS: DeactivateStaffFailure[] = ['self-delete', 'admin-managed-separately', 'responsibilities-in-progress']

/**
 * Deactivates a staff member (Delete on the Staff list and their page) through deactivate_staff: their
 * profile is ended in the database, they are signed out everywhere and can no longer use Hawkim, and
 * nothing is removed (their name stays on history). Returns when it was done. A repeated request
 * succeeds without changing anything. Throws a DeactivateStaffError.
 */
export async function deactivateStaff(userId: string): Promise<{ deactivatedAt: string }> {
  let response
  try {
    response = await supabase().rpc('deactivate_staff', { p_user_id: userId })
  } catch {
    throw new DeactivateStaffError('failed')
  }
  const error = response.error
  if (error) {
    const hinted = DEACTIVATE_HINTS.find((reason) => reason === error.hint)
    if (hinted) throw new DeactivateStaffError(hinted, hinted === 'responsibilities-in-progress' ? blockingTotal(error.details) : 0)
    // PGRST30x: the session's token has expired or isn't valid.
    if (error.code === '42501' || error.code?.startsWith('PGRST30')) throw new DeactivateStaffError('forbidden')
    if (error.code === 'P0002') throw new DeactivateStaffError('not-found')
    throw new DeactivateStaffError('failed')
  }
  const deactivatedAt = (response.data as { deactivatedAt?: unknown } | null)?.deactivatedAt
  if (typeof deactivatedAt !== 'string') throw new DeactivateStaffError('failed')
  return { deactivatedAt }
}

/** Why a deactivated staff member could not be reactivated. */
export type ReactivateStaffFailure =
  | 'forbidden' | 'not-found' | 'admin-managed-separately' | 'email-taken' | 'account-unavailable' | 'department-unavailable' | 'failed'

export class ReactivateStaffError extends Error {
  readonly reason: ReactivateStaffFailure
  constructor(reason: ReactivateStaffFailure) {
    super(`The staff member was not reactivated (${reason})`)
    this.reason = reason
  }
}

const REACTIVATE_HINTS: ReactivateStaffFailure[] = ['admin-managed-separately', 'email-taken', 'account-unavailable', 'department-unavailable']

/**
 * Reactivates a deactivated staff member (Reactivate on the Deactive Staff tab) through reactivate_staff:
 * the same profile and sign-in account are active again, with the permissions, department and history
 * they had (nothing is created or reassigned). A repeated request succeeds without changing anything.
 * Throws a ReactivateStaffError.
 */
export async function reactivateStaff(userId: string): Promise<void> {
  let response
  try {
    response = await supabase().rpc('reactivate_staff', { p_user_id: userId })
  } catch {
    throw new ReactivateStaffError('failed')
  }
  const error = response.error
  if (error) {
    const hinted = REACTIVATE_HINTS.find((reason) => reason === error.hint)
    if (hinted) throw new ReactivateStaffError(hinted)
    // PGRST30x: the session's token has expired or isn't valid.
    if (error.code === '42501' || error.code?.startsWith('PGRST30')) throw new ReactivateStaffError('forbidden')
    if (error.code === 'P0002') throw new ReactivateStaffError('not-found')
    throw new ReactivateStaffError('failed')
  }
  if ((response.data as { id?: unknown } | null)?.id !== userId) throw new ReactivateStaffError('failed')
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
