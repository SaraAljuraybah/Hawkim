import { createContext, useContext } from 'react'
import type { Department, DepartmentId, User } from '../data/mock/types'
import type { DepartmentInput, DepartmentRulesData } from '../lib/departmentAdmin'

/** Who is acting (must be an active admin among `users`). */
export interface DepartmentActor {
  actorId: string
  users: User[]
}

export interface DepartmentsStore {
  /** Every department, removed ones included (their names stay on old requests). */
  departments: Department[]
  /** Departments in use (not removed): every list, select and page. */
  activeDepartments: Department[]
  /** A department by id, removed or not. */
  getDepartment: (id: DepartmentId | undefined) => Department | undefined
  /** A department's name ('' if unknown). */
  nameOf: (id: DepartmentId | undefined) => string

  // Admin actions (PBI 13). Each checks the rules in lib/departmentAdmin.ts and throws if not allowed.
  /** Adds a department (valid, unique name and initials) and returns it. */
  addDepartment: (input: DepartmentInput, actor: DepartmentActor) => Department
  /** Changes the name, initials and description; the id never changes. */
  updateDepartment: (id: DepartmentId, input: DepartmentInput, actor: DepartmentActor) => void
  /** Removes an empty department (no members, SOPs, access or pending requests). */
  removeDepartment: (id: DepartmentId, actor: DepartmentActor & DepartmentRulesData) => void
}

export const DepartmentsContext = createContext<DepartmentsStore | null>(null)

/** Access the shared departments store. Must be used inside <DepartmentsProvider>. */
export function useDepartments(): DepartmentsStore {
  const store = useContext(DepartmentsContext)
  if (!store) throw new Error('useDepartments must be used inside <DepartmentsProvider>')
  return store
}
