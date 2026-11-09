import type { Department } from '../data/mock/types'
import type { ManagedDepartment, ManagementSnapshot } from '../services/organizationAdmin'
import { validateDepartment, type DepartmentInput, type DepartmentProblem } from './departmentAdmin'
import { storedDepartmentInitials } from './departmentInitials'

/*
 * Rules of the Add/Edit Department form (PBI 13 with divisions), kept apart from the page so
 * they can be tested without a browser. The server (save_department) enforces the same rules.
 * Initials aren't a form field: they are generated from the name (lib/departmentInitials.ts).
 */

export type DepartmentFormField = 'divisionId' | 'name' | 'description' | 'email'
export type DepartmentFormProblem = DepartmentProblem | 'division-required' | 'email-invalid'
export type DepartmentFormValues = Omit<DepartmentInput, 'initials'> & { divisionId: string; email: string }

/** Field order, for moving focus to the first problem. */
export const DEPARTMENT_FORM_FIELDS: DepartmentFormField[] = ['divisionId', 'name', 'description', 'email']

export const EMAIL_MAX = 254
/** name@domain.tld, the same pattern as division emails and the database check. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The department email is optional (empty is saved as none). When given, it is trimmed and must
 * look like name@domain.tld, up to 254 characters. Not unique: departments may share an address.
 */
export function departmentEmailProblem(email: string): 'email-invalid' | undefined {
  const value = email.trim()
  if (!value) return undefined
  return value.length > EMAIL_MAX || !EMAIL_PATTERN.test(value) ? 'email-invalid' : undefined
}

/** A legacy department without a division may keep none; every other department needs one. */
export function divisionIsOptional(department?: Pick<ManagedDepartment, 'division_id'>): boolean {
  return !!department && !department.division_id
}

/**
 * The division a form starts with: the edited department's own, or for a new department the
 * `?division=` value when it names an active division (otherwise none, so the admin chooses).
 */
export function initialDivisionId(
  snapshot: Pick<ManagementSnapshot, 'divisions'>,
  department?: Pick<ManagedDepartment, 'division_id'>,
  requested?: string | null,
): string {
  if (department) return department.division_id ?? ''
  return requested && snapshot.divisions.some((division) => division.id === requested) ? requested : ''
}

/** The initials saved with these values: generated from the name, never typed (see storedDepartmentInitials). */
export function formInitials(
  values: Pick<DepartmentFormValues, 'name'>,
  snapshot: Pick<ManagementSnapshot, 'departments'>,
  editing?: Pick<ManagedDepartment, 'id' | 'name' | 'initials'>,
): string {
  return storedDepartmentInitials(values.name, snapshot.departments, editing)
}

/** What is wrong with each field; uniqueness is checked against the snapshot's active departments. */
export function departmentFormProblems(
  input: DepartmentFormValues,
  snapshot: ManagementSnapshot,
  options: { editingId?: string; divisionOptional: boolean },
): Partial<Record<DepartmentFormField, DepartmentFormProblem>> {
  const others: Department[] = snapshot.departments.map(({ id, name, initials, description }) => ({ id, name, initials, description }))
  const known = snapshot.divisions.some((division) => division.id === input.divisionId)
  const editing = snapshot.departments.find((department) => department.id === options.editingId)
  // The generated initials are always valid and unused, so only the name and description can be wrong.
  const { name, description } = validateDepartment({ ...input, initials: formInitials(input, snapshot, editing) }, others, options.editingId)
  return {
    divisionId: (input.divisionId ? !known : !options.divisionOptional) ? 'division-required' : undefined,
    name,
    description,
    email: departmentEmailProblem(input.email),
  }
}

/**
 * Saves through the management RPC with the generated initials, then reloads the shared departments
 * list so the department's page can open with the saved values. A failed reload doesn't undo a successful save.
 */
export async function submitDepartmentForm(
  values: DepartmentFormValues,
  initials: string,
  editing: Pick<ManagedDepartment, 'id'> | undefined,
  expectedUpdatedAt: string | undefined,
  deps: {
    save: (input: DepartmentInput & { divisionId: string | null; email: string }, id?: string, expected?: string) => Promise<string>
    reload: () => Promise<void>
  },
): Promise<{ targetId: string; state: { notice: 'added' | 'updated' } }> {
  const targetId = await deps.save({ ...values, initials, divisionId: values.divisionId || null }, editing?.id, expectedUpdatedAt)
  try { await deps.reload() } catch { /* the list reloads again on the next organization change */ }
  return { targetId, state: { notice: editing ? 'updated' : 'added' } }
}
