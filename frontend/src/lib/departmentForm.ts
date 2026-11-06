import type { Department } from '../data/mock/types'
import type { ManagedDepartment, ManagementSnapshot } from '../services/organizationAdmin'
import { validateDepartment, type DepartmentField, type DepartmentInput, type DepartmentProblem } from './departmentAdmin'

/*
 * Rules of the Add/Edit Department form (PBI 13 with divisions), kept apart from the page so
 * they can be tested without a browser. The server (save_department) enforces the same rules.
 */

export type DepartmentFormField = 'divisionId' | DepartmentField
export type DepartmentFormProblem = DepartmentProblem | 'division-required'
export type DepartmentFormValues = DepartmentInput & { divisionId: string }

/** Field order, for moving focus to the first problem. */
export const DEPARTMENT_FORM_FIELDS: DepartmentFormField[] = ['divisionId', 'name', 'initials', 'description']

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

/** What is wrong with each field; uniqueness is checked against the snapshot's active departments. */
export function departmentFormProblems(
  input: DepartmentFormValues,
  snapshot: ManagementSnapshot,
  options: { editingId?: string; divisionOptional: boolean },
): Partial<Record<DepartmentFormField, DepartmentFormProblem>> {
  const others: Department[] = snapshot.departments.map(({ id, name, initials, description }) => ({ id, name, initials, description }))
  const known = snapshot.divisions.some((division) => division.id === input.divisionId)
  return {
    divisionId: (input.divisionId ? !known : !options.divisionOptional) ? 'division-required' : undefined,
    ...validateDepartment(input, others, options.editingId),
  }
}

/**
 * Saves through the management RPC, then reloads the shared departments list so the department's
 * page can open with the saved values. A failed reload doesn't undo a successful save.
 */
export async function submitDepartmentForm(
  values: DepartmentFormValues,
  editing: Pick<ManagedDepartment, 'id'> | undefined,
  expectedUpdatedAt: string | undefined,
  deps: {
    save: (input: DepartmentInput & { divisionId: string | null }, id?: string, expected?: string) => Promise<string>
    reload: () => Promise<void>
  },
): Promise<{ targetId: string; state: { notice: 'added' | 'updated' } }> {
  const targetId = await deps.save({ ...values, divisionId: values.divisionId || null }, editing?.id, expectedUpdatedAt)
  try { await deps.reload() } catch { /* the list reloads again on the next organization change */ }
  return { targetId, state: { notice: editing ? 'updated' : 'added' } }
}
