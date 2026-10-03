import { createContext, useContext } from 'react'
import type { Department, DepartmentId } from '../data/mock/types'

export interface ActiveDepartmentStore {
  /** The department the user is currently working in. */
  activeDepartment: Department
  /** Home department plus joined departments (approved access requests). */
  userDepartments: Department[]
  /** Switch department. Ignored if the user doesn't belong to it. */
  setActiveDepartment: (id: DepartmentId) => void
}

export const ActiveDepartmentContext = createContext<ActiveDepartmentStore | null>(null)

/** Access the active department. Must be used inside <ActiveDepartmentProvider>. */
export function useActiveDepartment(): ActiveDepartmentStore {
  const store = useContext(ActiveDepartmentContext)
  if (!store) throw new Error('useActiveDepartment must be used inside <ActiveDepartmentProvider>')
  return store
}
