import { createContext, useContext } from 'react'
import type { Department, DepartmentId } from '../data/mock/types'

export interface ActiveDepartmentStore {
  /** Selected published directory only; never an authoring or membership context. */
  activeDepartment: Department
  /** Actual home membership, independent of directory browsing. */
  homeDepartment: Department
  /** Home directory plus approved read-only directories. */
  directoryDepartments: Department[]
  /** Select an authorized directory without changing membership or roles. */
  setActiveDepartment: (id: DepartmentId) => void
}

export const ActiveDepartmentContext = createContext<ActiveDepartmentStore | null>(null)

/** Access the active department. Must be used inside <ActiveDepartmentProvider>. */
export function useActiveDepartment(): ActiveDepartmentStore {
  const store = useContext(ActiveDepartmentContext)
  if (!store) throw new Error('useActiveDepartment must be used inside <ActiveDepartmentProvider>')
  return store
}
