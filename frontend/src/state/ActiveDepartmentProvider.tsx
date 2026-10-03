import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DepartmentId } from '../data/mock/types'
import { getUserDepartments } from '../lib/departments'
import { ActiveDepartmentContext, type ActiveDepartmentStore } from './activeDepartmentContext'
import { useRequests } from './requestsContext'
import { useCurrentUser } from './sessionContext'

const STORAGE_KEY = 'hawkim.activeDepartment'

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null // storage unavailable (private mode, blocked): fall back to the home department
  }
}

/**
 * The department the user is working in (one at a time). Defaults to the home
 * department and is remembered in localStorage. If the remembered department is
 * no longer one of the user's departments, the home department is used instead.
 * Must be inside <RequestsProvider> (membership comes from approved requests) and
 * only used for a signed-in user.
 */
export function ActiveDepartmentProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser()
  const { requests } = useRequests()
  const userDepartments = useMemo(() => getUserDepartments(user, requests), [user, requests])

  const [selectedId, setSelectedId] = useState<string | null>(readStored)

  // Fall back to the home department when the selection isn't (or is no longer) valid.
  const activeDepartment =
    userDepartments.find((department) => department.id === selectedId) ??
    userDepartments.find((department) => department.id === user.departmentId) ??
    userDepartments[0]

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, activeDepartment.id)
    } catch {
      // Remembering the department is optional; ignore storage errors.
    }
  }, [activeDepartment.id])

  const setActiveDepartment = useCallback(
    (id: DepartmentId) => {
      if (userDepartments.some((department) => department.id === id)) setSelectedId(id)
    },
    [userDepartments],
  )

  const store = useMemo<ActiveDepartmentStore>(
    () => ({ activeDepartment, userDepartments, setActiveDepartment }),
    [activeDepartment, userDepartments, setActiveDepartment],
  )

  return <ActiveDepartmentContext.Provider value={store}>{children}</ActiveDepartmentContext.Provider>
}
