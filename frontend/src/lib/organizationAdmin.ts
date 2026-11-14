import type { ManagedDepartment, ManagementSnapshot } from '../services/organizationAdmin'
import { matchesDivisionDepartmentFilter, UNASSIGNED_GROUP_ID, type FilterDepartments } from './organization'

/**
 * How the table is ordered; 'default' keeps the server's order. 'division-…' orders the division rows;
 * 'department-…' orders the departments inside each division (the divisions keep their order).
 * Names A to Z or Z to A; staff and SOP counts high to low ('-desc') or low to high ('-asc').
 * Ties go by name A to Z (then the id).
 */
export const DIVISION_SORTS = [
  'default',
  'division-name-asc', 'division-name-desc',
  'division-staff-desc', 'division-staff-asc',
  'division-sops-desc', 'division-sops-asc',
  'department-name-asc', 'department-name-desc',
  'department-staff-desc', 'department-staff-asc',
  'department-sops-desc', 'department-sops-asc',
] as const
export type DivisionSort = (typeof DIVISION_SORTS)[number]
/** The Sort menu's groups: what each sort orders by (e.g. 'division-staff': a division's staff). */
export type DivisionSortGroup = 'division-name' | 'division-staff' | 'division-sops' | 'department-name' | 'department-staff' | 'department-sops'
/** The group each sort is listed under in the Sort menu ('default' has none). */
export const sortGroup = (sort: DivisionSort): DivisionSortGroup | undefined =>
  sort === 'default' ? undefined : (sort.slice(0, sort.lastIndexOf('-')) as DivisionSortGroup)

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

/** The department's filter group: its division, or the unassigned group (no division, or one that's gone). */
function departmentGroup(snapshot: ManagementSnapshot) {
  const divisionIds = new Set(snapshot.divisions.map((division) => division.id))
  const divisionOf = new Map(snapshot.departments.map((department) => [department.id, department.division_id]))
  return (id: string) => {
    const division = divisionOf.get(id)
    return division && divisionIds.has(division) ? division : UNASSIGNED_GROUP_ID
  }
}

/**
 * The departments without a division (or whose division is gone), listed last: those matching the search,
 * and, while filtering, only the chosen ones (a division filter alone leaves none).
 */
export function unassignedRows(snapshot: ManagementSnapshot, query = '', options: Pick<HierarchyOptions, 'divisions' | 'departments'> = {}) {
  const search = query.trim().toLowerCase()
  const groupOf = departmentGroup(snapshot)
  return snapshot.departments.filter((row) => groupOf(row.id) === UNASSIGNED_GROUP_ID && row.name.toLowerCase().includes(search)
    && matchesDivisionDepartmentFilter(row.id, options.divisions ?? [], options.departments ?? [], groupOf))
}

/** The Filter's data on this page: every division (even without departments) and every department. */
export function managementFilterData(snapshot: ManagementSnapshot): FilterDepartments {
  return {
    divisions: snapshot.divisions.map((division) => ({ id: division.id, name: division.name })),
    departments: snapshot.departments.map((department) => ({ id: department.id, name: department.name, divisionId: department.division_id })),
  }
}

/** Orders the rows (or each row's departments); equal values fall back to the name, then the id, so the order is always the same. */
function sortRows<T extends { division: { name: string; id: string }; employees: number; sops: number; children: { name: string; id: string; employees: number; sops: number }[] }>(rows: T[], sort: DivisionSort): T[] {
  if (sort === 'default') return rows
  type Item = { name: string; id: string; employees: number; sops: number }
  const orders: Record<'name-asc' | 'name-desc' | 'staff-desc' | 'staff-asc' | 'sops-desc' | 'sops-asc', (a: Item, b: Item) => number> = {
    'name-asc': byName,
    'name-desc': (a, b) => -byName(a, b),
    'staff-desc': (a, b) => b.employees - a.employees || byName(a, b),
    'staff-asc': (a, b) => a.employees - b.employees || byName(a, b),
    'sops-desc': (a, b) => b.sops - a.sops || byName(a, b),
    'sops-asc': (a, b) => a.sops - b.sops || byName(a, b),
  }
  if (sort.startsWith('department-')) {
    const order = orders[sort.slice('department-'.length) as keyof typeof orders]
    return rows.map((row) => ({ ...row, children: [...row.children].sort(order) }))
  }
  const order = orders[sort.slice('division-'.length) as keyof typeof orders]
  const item = (row: T): Item => ({ name: row.division.name, id: row.division.id, employees: row.employees, sops: row.sops })
  return [...rows].sort((a, b) => order(item(a), item(b)))
}

/**
 * Why a department can't be deleted (none: it can). Active employees and SOPs that still exist both block it,
 * as in the database (delete_department, 20261109120000). Employees are reported first, also when there are SOPs
 * too (the database checks them first as well). A department already waiting on file cleanup is never blocked by
 * SOPs: its SOPs are marked deleted, and its Delete button retries the cleanup.
 */
export function departmentDeleteBlocker(department: Pick<ManagedDepartment, 'employees' | 'sops' | 'deletion_job_id'>): 'employees' | 'sops' | undefined {
  if (department.employees > 0) return 'employees'
  return !department.deletion_job_id && department.sops > 0 ? 'sops' : undefined
}
