import type { Department, DepartmentId } from './types'

/*
 * Sample departments (from the approved design).
 * TODO: Replace with data from the backend API.
 */
export const departments: Department[] = [
  { id: 'quality-assurance', name: 'Quality Assurance' },
  { id: 'pharmacovigilance', name: 'Pharmacovigilance' },
  { id: 'regulatory-affairs', name: 'Regulatory Affairs' },
  { id: 'information-technology', name: 'Information Technology' },
]

/** Department name for an id (empty string if unknown). */
export function getDepartmentName(id: DepartmentId): string {
  return departments.find((department) => department.id === id)?.name ?? ''
}
