import type { Permission, User } from '../data/mock/types'
import { PERMISSIONS } from '../lib/userAdmin'
import { supabase } from './supabase'

// Deliberately excludes email, phone and authentication information.
export type OrganizationEmployee = Pick<User, 'id' | 'name' | 'initials' | 'permissions'> & { position?: string | null }
export interface OrganizationDepartment {
  id: string
  name: string
  divisionId: string | null
  employees: OrganizationEmployee[]
}
export interface OrganizationHierarchy {
  organization: { name: string } | null
  divisions: { id: string; name: string }[]
  departments: OrganizationDepartment[]
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string'

/** Reject malformed nested RPC data before it can crash the chart or mislabel roles. */
function isHierarchy(value: unknown): value is OrganizationHierarchy {
  if (!record(value) || !(value.organization === null || (record(value.organization) && text(value.organization.name))) ||
    !Array.isArray(value.divisions) || !Array.isArray(value.departments)) return false
  const divisionIds = new Set<string>()
  const departmentIds = new Set<string>()
  const employeeIds = new Set<string>()
  return value.divisions.every((division: unknown) => {
    if (!record(division) || !text(division.id) || !text(division.name) || divisionIds.has(division.id)) return false
    divisionIds.add(division.id)
    return true
  }) && value.departments.every((department: unknown) => {
    if (!record(department) || !text(department.id) || !text(department.name) || departmentIds.has(department.id) ||
      !(department.divisionId === null || text(department.divisionId)) || !Array.isArray(department.employees)) return false
    departmentIds.add(department.id)
    return department.employees.every((employee: unknown) => {
      if (!record(employee) || !text(employee.id) || !text(employee.name) || !text(employee.initials) || employeeIds.has(employee.id) ||
        !(employee.position == null || text(employee.position)) || !Array.isArray(employee.permissions) ||
        !employee.permissions.every((permission: unknown) => text(permission) && PERMISSIONS.includes(permission as Permission)) ||
        new Set(employee.permissions).size !== employee.permissions.length) return false
      employeeIds.add(employee.id)
      return true
    })
  })
}

/** A single authenticated, Admin-only database snapshot; never falls back to mock data. */
export async function fetchOrganization(): Promise<OrganizationHierarchy> {
  const { data, error } = await supabase().rpc('get_organizational_structure')
  if (error) throw new Error(error.message)
  if (!isHierarchy(data)) {
    throw new Error('Invalid organizational structure response')
  }
  return data
}
