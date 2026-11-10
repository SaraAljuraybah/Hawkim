import type { Permission, User } from '../data/mock/types'
import { PERMISSIONS } from '../lib/userAdmin'
import { supabase } from './supabase'

// Includes the work email (readable by every active user); deliberately excludes phone and authentication information.
export type OrganizationEmployee = Pick<User, 'id' | 'name' | 'initials' | 'email' | 'permissions'> & { position?: string | null }
export interface OrganizationDepartment {
  id: string
  name: string
  divisionId: string | null
  /** Optional contact email (null when none; missing before migration 20261110140000). */
  email?: string | null
  employees: OrganizationEmployee[]
}
export interface OrganizationHierarchy {
  organization: { name: string } | null
  divisions: { id: string; name: string; email?: string | null }[]
  departments: OrganizationDepartment[]
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string'
/** An optional email: missing, null or a string. */
const optionalText = (value: unknown) => value === undefined || value === null || text(value)

/** Reject malformed nested RPC data before it can crash the chart or mislabel roles. */
function isHierarchy(value: unknown): value is OrganizationHierarchy {
  if (!record(value) || !(value.organization === null || (record(value.organization) && text(value.organization.name))) ||
    !Array.isArray(value.divisions) || !Array.isArray(value.departments)) return false
  const divisionIds = new Set<string>()
  const departmentIds = new Set<string>()
  const employeeIds = new Set<string>()
  return value.divisions.every((division: unknown) => {
    if (!record(division) || !text(division.id) || !text(division.name) || !optionalText(division.email) || divisionIds.has(division.id)) return false
    divisionIds.add(division.id)
    return true
  }) && value.departments.every((department: unknown) => {
    if (!record(department) || !text(department.id) || !text(department.name) || departmentIds.has(department.id) ||
      !(department.divisionId === null || text(department.divisionId)) || !optionalText(department.email) || !Array.isArray(department.employees)) return false
    departmentIds.add(department.id)
    return department.employees.every((employee: unknown) => {
      if (!record(employee) || !text(employee.id) || !text(employee.name) || !text(employee.initials) || !text(employee.email) || employeeIds.has(employee.id) ||
        !(employee.position == null || text(employee.position)) || !Array.isArray(employee.permissions) ||
        !employee.permissions.every((permission: unknown) => text(permission) && PERMISSIONS.includes(permission as Permission)) ||
        new Set(employee.permissions).size !== employee.permissions.length) return false
      employeeIds.add(employee.id)
      return true
    })
  })
}

/** A single authenticated database snapshot for any active user; never falls back to mock data. */
export async function fetchOrganization(): Promise<OrganizationHierarchy> {
  const { data, error } = await supabase().rpc('get_organizational_structure')
  if (error) throw new Error(error.message)
  if (!isHierarchy(data)) {
    throw new Error('Invalid organizational structure response')
  }
  // Admins belong to no department (whatever their account still holds): they aren't listed in one.
  return { ...data, departments: data.departments.map((department) => ({
    ...department, employees: department.employees.filter((employee) => !employee.permissions.includes('admin')),
  })) }
}
