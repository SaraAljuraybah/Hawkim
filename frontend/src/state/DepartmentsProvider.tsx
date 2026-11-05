import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { validateWorkflowConfiguration } from '../lib/reviewFlow'
import type { Department, DepartmentId } from '../data/mock/types'
import {
  normalizeDepartment,
  validateDepartment,
  type DepartmentInput,
} from '../lib/departmentAdmin'
import { DepartmentsContext, type DepartmentActor, type DepartmentsStore } from './departmentsContext'
import { useLoadAfterSignIn } from './useLoadAfterSignIn'
import { fetchDepartments } from '../services/people'
import { saveDepartment, deleteDepartment, ORGANIZATION_CHANGED, organizationEvents } from '../services/organizationAdmin'
import { useSession } from './sessionContext'

/** Refuses anyone who isn't an active admin. */
function assertAdmin({ actorId, users }: DepartmentActor) {
  const actor = users.find((user) => user.id === actorId && !user.deletedAt)
  if (!actor?.permissions.includes('admin')) throw new Error('Only an admin can manage departments')
}

/** Shared database-backed department directory. */
export function DepartmentsProvider({ children }: { children: ReactNode }) {
  const [departments, setDepartments] = useState<Department[]>([])
  // The latest list (as in the other stores): actions check against it, not the last render.
  const latestRef = useRef<Department[]>(departments)
  const commit = useCallback((next: Department[]) => {
    latestRef.current = next
    setDepartments(next)
  }, [])
  const baseStatus = useLoadAfterSignIn(fetchDepartments, commit)
  const [refreshError, setRefreshError] = useState<string>()
  const identity = useSession().user?.id
  useEffect(() => {
    let active = true
    const reload = () => { void fetchDepartments().then((rows) => { if (active) { commit(rows); setRefreshError(undefined) } }).catch(() => { if (active) setRefreshError(identity) }) }
    organizationEvents.addEventListener(ORGANIZATION_CHANGED, reload)
    return () => { active = false; organizationEvents.removeEventListener(ORGANIZATION_CHANGED, reload) }
  }, [identity, commit])

  const status = identity && refreshError === identity ? 'error' : baseStatus
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

  const addDepartment = useCallback(async (input: DepartmentInput, actor: DepartmentActor) => {
    assertAdmin(actor)
    assertValid(input)
    const values = normalizeDepartment(input)
    const id = await saveDepartment(values)
    const created: Department = { id, ...values }
    commit(await fetchDepartments())
    return created
  }, [commit])

  const updateDepartment = useCallback(async (id: string, input: DepartmentInput, actor: DepartmentActor) => {
    assertAdmin(actor)
    assertValid(input, id)
    const previous = latestRef.current.find((row) => row.id === id && !row.removedAt)
    if (!previous) throw new Error('Unknown department')
    await saveDepartment(input, id, previous.updatedAt)
    commit(await fetchDepartments())
  }, [commit])

  const configureWorkflow = useCallback<DepartmentsStore['configureWorkflow']>((id, input, actor) => {
    assertAdmin(actor)
    if (!latestRef.current.some((d) => d.id === id && !d.removedAt)) throw new Error('Unknown department')
    const values = validateWorkflowConfiguration(input, actor.users)
    commit(latestRef.current.map((department) => department.id === id ? { ...department, ...values } : department))
  }, [commit])

  const removeDepartment = useCallback<DepartmentsStore['removeDepartment']>(async (id, context, disposition = 'empty') => {
    assertAdmin(context)
    const previous = latestRef.current.find((row) => row.id === id && !row.removedAt)
    if (!previous?.updatedAt) throw new Error('Refresh the department before deleting')
    await deleteDepartment({ id, updated_at: previous.updatedAt }, disposition)
    commit(await fetchDepartments())
  }, [commit])

  const store = useMemo<DepartmentsStore>(
    () => ({ status, departments, activeDepartments, getDepartment, nameOf, addDepartment, updateDepartment, configureWorkflow, removeDepartment }),
    [status, departments, activeDepartments, getDepartment, nameOf, addDepartment, updateDepartment, configureWorkflow, removeDepartment],
  )

  return <DepartmentsContext.Provider value={store}>{children}</DepartmentsContext.Provider>
}
