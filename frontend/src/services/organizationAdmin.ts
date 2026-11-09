import type { User } from '../data/mock/types'
import { supabase } from './supabase'
import { organizationAdminEn as text } from '../content/organizationAdmin.en'
import type { DepartmentInput } from '../lib/departmentAdmin'

export interface DivisionRecord {
  id: string; name: string; description: string | null; email: string | null; updated_at: string | null
  /** Server-computed totals over ALL of the division's departments (distinct employees, SOP records). */
  department_count?: number; employees?: number; sops?: number
}
/** An employee as listed in a department: roles plus every position (job title) held there. */
export type ManagedPerson = User & { positions: string[] }
export interface ManagedDepartment {
  id: string; name: string; initials: string; description: string; division_id: string | null;
  /** Optional contact email, admin-only (null when none; missing before migration 20261108150000). */
  email?: string | null
  updated_at: string; deletion_job_id?: string | null; people?: ManagedPerson[]; employees: number; sops: number; status_counts: Record<string, number>
}
export interface ManagementSnapshot { divisions: DivisionRecord[]; departments: ManagedDepartment[] }
/** 'empty': delete a department without SOPs; 'delete': retry the file cleanup of an already confirmed deletion. */
export type SopDisposition = 'empty' | 'delete'
export const ORGANIZATION_CHANGED = 'hawkim:organization-changed'
export const organizationEvents = new EventTarget()

export function managementError(error: { code?: string; message?: string }): Error {
  if (error.code === '42501') return new Error(text.forbidden)
  if (error.code === '40001' || error.code === 'P0002') return new Error(text.conflict)
  if (error.code === '23505') return new Error(text.duplicate)
  const known = error.message ? DATABASE_MESSAGES[error.message] : undefined
  return new Error(known ?? (error.code === '23514' ? text.invalid : text.failed))
}

/** The exact refusals raised in supabase/migrations/2026110512*–16*, as what the admin should do next. */
const DATABASE_MESSAGES: Record<string, string> = {
  'A position is required for a department assignment': text.positionRequired,
  'Divisions with assigned departments cannot be deleted.': text.divisionBlocked,
  'Departments with assigned employees cannot be deleted.': text.departmentBlocked,
  'Settle active reviews and compliance checks before deleting this department.': text.activeWorkflow,
  'Departments with SOPs cannot be deleted.': text.departmentHasSopsBlocked,
  'Department file cleanup is pending': text.departmentPendingCleanup,
  'Department is no longer available': text.departmentUnavailable,
  'Select an active division': text.requiredDivision,
  'Select a division': text.requiredDivision,
}
async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(name, args)
  if (error) throw managementError(error)
  return data as T
}
function changed() { organizationEvents.dispatchEvent(new Event(ORGANIZATION_CHANGED)) }
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0
function isSnapshot(value: unknown): value is ManagementSnapshot {
  if (!object(value) || !Array.isArray(value.divisions) || !Array.isArray(value.departments)) return false
  const divisionIds = new Set<string>(), departmentIds = new Set<string>()
  return value.divisions.every((row: unknown) => {
    if (!object(row) || typeof row.id !== 'string' || typeof row.name !== 'string' || divisionIds.has(row.id) ||
      !(row.description === null || typeof row.description === 'string') || !(row.email === null || typeof row.email === 'string') ||
      !(row.updated_at === null || typeof row.updated_at === 'string') ||
      [row.department_count, row.employees, row.sops].some((total) => total !== undefined && !count(total))) return false
    divisionIds.add(row.id); return true
  }) && value.departments.every((row: unknown) => {
    if (!object(row) || typeof row.id !== 'string' || departmentIds.has(row.id) || typeof row.name !== 'string' ||
      typeof row.initials !== 'string' || typeof row.description !== 'string' || typeof row.updated_at !== 'string' ||
      !(row.email === undefined || row.email === null || typeof row.email === 'string') ||
      !(row.division_id === null || typeof row.division_id === 'string') || !count(row.employees) || !count(row.sops) ||
      !object(row.status_counts) || !Object.values(row.status_counts).every(count) || !Array.isArray(row.people)) return false
    departmentIds.add(row.id)
    const people = new Set<string>()
    return row.people.length === row.employees && row.people.every((person: unknown) => {
      if (!object(person) || typeof person.id !== 'string' || people.has(person.id) || typeof person.name !== 'string' ||
        typeof person.email !== 'string' || typeof person.initials !== 'string' || person.departmentId !== row.id ||
        !Array.isArray(person.permissions) || !person.permissions.every((role) => ['author','reviewer','approver','admin'].includes(role)) ||
        !Array.isArray(person.positions) || !person.positions.every((title) => typeof title === 'string' && title.length > 0)) return false
      people.add(person.id); return true
    })
  })
}
export async function fetchManagement(): Promise<ManagementSnapshot> {
  const data = await call<unknown>('get_divisions_departments')
  if (!isSnapshot(data)) throw new Error(text.loadFailed)
  return data
}
export async function saveDivision(input: { name: string; description: string; email: string }, previous?: DivisionRecord) {
  const id = await call<string>('save_division', { p_id: previous?.id ?? null, p_name: input.name.trim(),
    p_description: input.description.trim(), p_email: input.email.trim(), p_expected_updated_at: previous?.updated_at ?? null })
  changed(); return id
}
export async function deleteDivision(division: DivisionRecord) {
  await call('delete_division', { p_id: division.id, p_expected_updated_at: division.updated_at }); changed()
}
export async function saveDepartment(
  input: DepartmentInput & { divisionId?: string | null; email?: string },
  id?: string,
  expected?: string
) {
  const result = await call<string>('save_department', { p_id: id ?? null, p_name: input.name.trim(),
    p_initials: input.initials.trim().toUpperCase(), p_description: input.description.trim(),
    p_division_id: input.divisionId ?? null, p_expected_updated_at: expected ?? null,
    // Optional: empty is saved as none.
    p_email: input.email?.trim() || null })
  changed(); return result
}
/** Replaces an employee's positions in their department (admin only, enforced by the database). */
export async function setEmployeePositions(profileId: string, titles: string[]) {
  await call('set_employee_positions', { p_profile_id: profileId, p_titles: titles.map((title) => title.trim()).filter(Boolean) })
  changed()
}
/** Permanent deletion is completed by the authenticated server worker, never browser Storage credentials. */
export async function deleteDepartment(department: Pick<ManagedDepartment, 'id' | 'updated_at' | 'deletion_job_id'>, disposition: SopDisposition) {
  if (disposition !== 'delete' && !department.deletion_job_id) {
    await call('delete_department', { p_id: department.id, p_sop_action: disposition, p_expected_updated_at: department.updated_at })
    changed()
    return
  }
  let jobId = department.deletion_job_id
  try {
    // Each invocation processes a bounded batch. Large jobs stay persisted and can be resumed.
    for (let batch = 0; batch < 10; batch++) {
      const { data, error } = await supabase().functions.invoke('delete-department', {
        body: jobId ? { jobId } : { departmentId: department.id, expectedUpdatedAt: department.updated_at, confirmDeleteSops: true },
      })
      changed()
      let failure = data as { errorCode?: string; state?: string; jobId?: string } | null
      if (error) {
        // Supabase puts non-2xx JSON bodies on FunctionsHttpError.context.
        try { failure = await error.context?.json() ?? failure } catch { /* use the safe fallback below */ }
        if (failure?.errorCode === 'employees-assigned') throw new Error(text.departmentBlocked)
        if (failure?.errorCode === 'active-workflow') throw new Error(text.activeWorkflow)
        if (failure?.errorCode === 'forbidden' || failure?.errorCode === 'unauthorized') throw new Error(text.forbidden)
        if (failure?.errorCode === 'conflict') throw new Error(text.conflict)
        throw new Error(text.cleanupIncomplete)
      }
      if (failure?.state === 'completed') return
      jobId = failure?.jobId
      if (!jobId || failure?.state === 'busy') throw new Error(text.cleanupIncomplete)
    }
    throw new Error(text.cleanupPending)
  } catch (error) {
    changed() // Preparation may have committed even when the network response was lost.
    throw error instanceof Error && ([text.departmentBlocked,text.activeWorkflow,text.forbidden,text.conflict,text.cleanupIncomplete,text.cleanupPending] as readonly string[]).includes(error.message)
      ? error : new Error(text.cleanupIncomplete)
  }
}
