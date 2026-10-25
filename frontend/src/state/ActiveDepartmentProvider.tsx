import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DepartmentId } from '../data/mock/types'
import { getDirectoryDepartments } from '../lib/departments'
import { ActiveDepartmentContext, type ActiveDepartmentStore } from './activeDepartmentContext'
import { readStoredActiveDepartment, storeActiveDepartment } from './activeDepartmentStorage'
import { useDepartments } from './departmentsContext'
import { useRequests } from './requestsContext'
import { useCurrentUser } from './sessionContext'

/**
 * The selected published SOP directory. Approved requests add read-only browsing
 * choices; home membership and authoring remain independent of this selection.
 * Must be inside <RequestsProvider> and only used for a signed-in user.
 */
export function ActiveDepartmentProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser()
  const { requests } = useRequests()
  const { activeDepartments, departments } = useDepartments()
  const homeDepartment = useMemo(() => departments.find((department) => department.id === user.departmentId) ?? {
    id: user.departmentId, name: user.departmentId, initials: '', description: '',
  }, [departments, user.departmentId])
  const directoryDepartments = useMemo(
    () => getDirectoryDepartments(user, requests, activeDepartments),
    [user, requests, activeDepartments],
  )

  const [selectedId, setSelectedId] = useState<string | null>(readStoredActiveDepartment)

  // Fall back to the home department when the selection isn't (or is no longer) valid.
  const activeDepartment =
    directoryDepartments.find((department) => department.id === selectedId) ??
    directoryDepartments.find((department) => department.id === user.departmentId) ??
    directoryDepartments[0] ?? homeDepartment

  useEffect(() => storeActiveDepartment(activeDepartment.id), [activeDepartment.id])

  const setActiveDepartment = useCallback(
    (id: DepartmentId) => {
      if (directoryDepartments.some((department) => department.id === id)) setSelectedId(id)
    },
    [directoryDepartments],
  )

  const store = useMemo<ActiveDepartmentStore>(
    () => ({ activeDepartment, homeDepartment, directoryDepartments, setActiveDepartment }),
    [activeDepartment, homeDepartment, directoryDepartments, setActiveDepartment],
  )

  return <ActiveDepartmentContext.Provider value={store}>{children}</ActiveDepartmentContext.Provider>
}
