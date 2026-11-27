import type { DivisionRecord, ManagedDepartment, ManagementSnapshot } from '../services/organizationAdmin'
import { matchesDivisionDepartmentFilter, type FilterDepartments } from './organization'

/**
 * The Sort field of Divisions and Departments. 'default' is Division name A to Z, with each division's departments
 * A to Z too (listed as Division name, A to Z). 'division-desc' orders the divisions Z to A; 'department-…' orders
 * the departments inside each division (the divisions stay A to Z). Number of Staff and Number of SOPs order the
 * divisions by their totals and, inside each division, its departments by their own counts. A department never
 * leaves its division. Ties go by name A to Z, then the id.
 */
export const DIVISION_SORTS = [
  'default', 'division-desc',
  'department-asc', 'department-desc',
  'staff-asc', 'staff-desc',
  'sops-asc', 'sops-desc',
] as const
export type DivisionSort = (typeof DIVISION_SORTS)[number]
export type DivisionSortGroup = 'division' | 'department' | 'staff' | 'sops'
export type SortDirection = 'asc' | 'desc'
/** The group each sort is listed under in the Sort menu; the default is under Division name (it is A to Z). */
export const divisionSortGroup = (sort: DivisionSort): DivisionSortGroup =>
  sort === 'default' ? 'division' : (sort.slice(0, sort.lastIndexOf('-')) as DivisionSortGroup)

export interface HierarchyOptions {
  /** Division ids to show (any of them); empty or missing shows every division. */
  divisions?: string[]
  /**
   * Department ids to show, with the linked rule of every list page: a division with departments chosen
   * lists only those (and opens by itself); a chosen division without any keeps all its departments.
   */
  departments?: string[]
  sort?: DivisionSort
}

export type HierarchyRow = ReturnType<typeof hierarchyRows>[number]

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)

/**
 * Totals always use all children. Search and the division filter only decide which rows are
 * displayed; sorting only changes their order, never their totals.
 */
export function hierarchyRows(snapshot: ManagementSnapshot, query = '', options: HierarchyOptions = {}) {
  const search = query.trim().toLowerCase()
  const divisions = options.divisions ?? []
  const departments = options.departments ?? []
  const filtering = divisions.length > 0 || departments.length > 0
  const groupOf = departmentGroup(snapshot)
  const rows = snapshot.divisions.map((division) => {
    const children = snapshot.departments.filter((department) => department.division_id === division.id)
    // The filter decides which departments are listed; the search then looks in those.
    const kept = filtering ? children.filter((child) => matchesDivisionDepartmentFilter(child.id, divisions, departments, groupOf)) : children
    const picked = departments.some((id) => groupOf(id) === division.id)
    const match = division.name.toLowerCase().includes(search)
    return { division, children: kept.filter((child) => match || child.name.toLowerCase().includes(search)),
      // Prefer the server's totals (distinct people); fall back to summing every child row.
      departmentCount: division.department_count ?? children.length,
      employees: division.employees ?? children.reduce((sum, row) => sum + row.employees, 0),
      sops: division.sops ?? children.reduce((sum, row) => sum + row.sops, 0),
      /** Departments of this division are chosen in the filter: it opens by itself. */
      picked,
      matches: (match || kept.some((child) => child.name.toLowerCase().includes(search))) && (!filtering || picked || divisions.includes(division.id)) }
  }).filter((row) => row.matches)
  return sortRows(rows, options.sort ?? 'default')
}

/** The department's filter group: its division (every active department has one: 20261124120000). */
function departmentGroup(snapshot: ManagementSnapshot) {
  const divisionOf = new Map(snapshot.departments.map((department) => [department.id, department.division_id]))
  return (id: string) => divisionOf.get(id) ?? ''
}

/** The Filter's data on this page: every division (even without departments) and every department. */
export function managementFilterData(snapshot: ManagementSnapshot): FilterDepartments {
  return {
    divisions: snapshot.divisions.map((division) => ({ id: division.id, name: division.name })),
    departments: snapshot.departments.map((department) => ({ id: department.id, name: department.name, divisionId: department.division_id })),
  }
}

type Counted = { name: string; id: string; employees: number; sops: number }

type Compare = (a: Counted, b: Counted) => number
const byNameDesc: Compare = (a, b) => -byName(a, b)

/** A count's order; equal values fall back to the name, then the id, so the order is always the same. */
function countOrder(key: 'staff' | 'sops', direction: SortDirection): Compare {
  const value = (item: Counted) => (key === 'staff' ? item.employees : item.sops)
  return (a, b) => (direction === 'asc' ? value(a) - value(b) : value(b) - value(a)) || byName(a, b)
}

/** How a sort orders the divisions, and the departments inside each one. */
function ordersOf(sort: DivisionSort): { divisions: Compare; departments: Compare } {
  switch (sort) {
    case 'default': case 'department-asc': return { divisions: byName, departments: byName }
    case 'division-desc': return { divisions: byNameDesc, departments: byName }
    case 'department-desc': return { divisions: byName, departments: byNameDesc }
    default: {
      const [key, direction] = sort.split('-') as ['staff' | 'sops', SortDirection]
      const order = countOrder(key, direction)
      return { divisions: order, departments: order }
    }
  }
}

/** Orders departments as the sort orders them inside a division (the departments without a division too). */
export function sortDepartments<T extends Counted>(departments: T[], sort: DivisionSort = 'default'): T[] {
  return [...departments].sort(ordersOf(sort).departments)
}

/** Orders the divisions, then each division's departments, so a department never leaves its division. */
function sortRows<T extends { division: { name: string; id: string }; employees: number; sops: number; children: Counted[] }>(rows: T[], sort: DivisionSort): T[] {
  const { divisions } = ordersOf(sort)
  const item = (row: T): Counted => ({ name: row.division.name, id: row.division.id, employees: row.employees, sops: row.sops })
  return [...rows].sort((a, b) => divisions(item(a), item(b))).map((row) => ({ ...row, children: sortDepartments(row.children, sort) }))
}

/**
 * Why a department can't be deleted (none: it can). One of the organization's default departments never can
 * (20261120120000), whatever else is true. Active employees and SOPs that still exist both block it,
 * as in the database (delete_department, 20261109120000). Employees are reported first, also when there are SOPs
 * too (the database checks them first as well). A department already waiting on file cleanup is never blocked by
 * SOPs: its SOPs are marked deleted, and its Delete button retries the cleanup.
 */
export function departmentDeleteBlocker(
  department: Pick<ManagedDepartment, 'employees' | 'sops' | 'deletion_job_id' | 'system_key'>,
): 'default' | 'employees' | 'sops' | undefined {
  if (isDefaultDepartment(department)) return 'default'
  if (department.employees > 0) return 'employees'
  return !department.deletion_job_id && department.sops > 0 ? 'sops' : undefined
}

/** One of the organization's two default departments (Pharmacovigilance, Quality Assurance): never deleted or renamed. */
export function isDefaultDepartment(department: Pick<ManagedDepartment, 'system_key'>): boolean {
  return !!department.system_key
}

/**
 * Whether another active division already has this name, as save_division compares names: ignoring case and
 * leading or trailing spaces (lower(btrim(name)), 20261119130000; the unique index divisions_organization_name_unique,
 * 20261124120000). The division being edited (exceptId) doesn't count, so it can keep its own name or change its case.
 */
export function divisionNameTaken(divisions: readonly Pick<DivisionRecord, 'id' | 'name'>[], name: string, exceptId?: string): boolean {
  const key = name.trim().toLowerCase()
  return !!key && divisions.some((division) => division.id !== exceptId && division.name.trim().toLowerCase() === key)
}
