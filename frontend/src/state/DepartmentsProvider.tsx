import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { validateWorkflowConfiguration } from '../lib/reviewFlow'
import type { Department, DepartmentId } from '../data/mock/types'
import {
  departmentIdFor,
  normalizeDepartment,
  removalBlockers,
  validateDepartment,
  type DepartmentInput,
} from '../lib/departmentAdmin'
import { DepartmentsContext, type DepartmentActor, type DepartmentsStore } from './departmentsContext'
import { useLoadAfterSignIn } from './useLoadAfterSignIn'
import { fetchDepartments } from '../services/people'

/** Refuses anyone who isn't an active admin. */
function assertAdmin({ actorId, users }: DepartmentActor) {
  const actor = users.find((user) => user.id === actorId && !user.deletedAt)
  if (!actor?.permissions.includes('admin')) throw new Error('Only an admin can manage departments')
}

/**
 * Departments store shared by the employee screens and the admin portal. The
 * departments are loaded from the database after sign-in. The admin actions only
 * change this tab's copy (lost on reload).
 * TODO: Save admin changes once those features are connected.
 * Must be inside <SessionProvider>.
 */
export function DepartmentsProvider({ children }: { children: ReactNode }) {
  const [departments, setDepartments] = useState<Department[]>([])
  // The latest list (as in the other stores): actions check against it, not the last render.
  const latestRef = useRef<Department[]>(departments)
  const commit = useCallback((next: Department[]) => {
    latestRef.current = next
    setDepartments(next)
  }, [])
  const status = useLoadAfterSignIn(fetchDepartments, commit)

  const activeDepartments = useMemo(() => departments.filter((department) => !department.removedAt), [departments])
  const getDepartment = useCallback(
    (id: DepartmentId | undefined) => departments.find((department) => department.id === id),
    [departments],
  )
  const nameOf = useCallback((id: DepartmentId | undefined) => getDepartment(id)?.name ?? '', [getDepartment])

  const assertValid = (input: DepartmentInput, editingId?: DepartmentId) => {
    const problems = validateDepartment(input, latestRef.current, editingId)
    if (Object.values(problems).some(Boolean)) throw new Error('The department is not valid')
  }

  const addDepartment = useCallback(
    (input: DepartmentInput, actor: DepartmentActor) => {
      assertAdmin(actor)
      assertValid(input)
      const values = normalizeDepartment(input)
      const created: Department = { id: departmentIdFor(values.name, latestRef.current), ...values }
      commit([...latestRef.current, created])
      return created
    },
    [commit],
  )

  const updateDepartment = useCallback(
    (id: DepartmentId, input: DepartmentInput, actor: DepartmentActor) => {
      assertAdmin(actor)
      if (!latestRef.current.some((department) => department.id === id && !department.removedAt)) {
        throw new Error(`Unknown department ${id}`)
      }
      assertValid(input, id)
      const values = normalizeDepartment(input)
      commit(latestRef.current.map((department) => (department.id === id ? { ...department, ...values } : department)))
    },
    [commit],
  )

  const configureWorkflow = useCallback<DepartmentsStore['configureWorkflow']>((id, input, actor) => {
    assertAdmin(actor)
    if (!latestRef.current.some((d) => d.id === id && !d.removedAt)) throw new Error('Unknown department')
    const values = validateWorkflowConfiguration(input, actor.users)
    commit(latestRef.current.map((department) => department.id === id ? { ...department, ...values } : department))
  }, [commit])

  const removeDepartment = useCallback<DepartmentsStore['removeDepartment']>(
    (id, context) => {
      assertAdmin(context)
      if (!latestRef.current.some((department) => department.id === id && !department.removedAt)) {
        throw new Error(`Unknown department ${id}`)
      }
      if (removalBlockers(id, context).length > 0) throw new Error('This department can’t be removed now')
      const removedAt = new Date().toISOString()
      commit(latestRef.current.map((department) => (department.id === id ? { ...department, removedAt } : department)))
    },
    [commit],
  )

  const store = useMemo<DepartmentsStore>(
    () => ({ status, departments, activeDepartments, getDepartment, nameOf, addDepartment, updateDepartment, configureWorkflow, removeDepartment }),
    [status, departments, activeDepartments, getDepartment, nameOf, addDepartment, updateDepartment, configureWorkflow, removeDepartment],
  )

  return <DepartmentsContext.Provider value={store}>{children}</DepartmentsContext.Provider>
}
