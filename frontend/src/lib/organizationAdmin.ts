import type { ManagedDepartment, ManagementSnapshot } from '../services/organizationAdmin'

/**
 * How the table is ordered; 'default' keeps the server's order. 'division-…' orders the division rows;
 * 'department-…' orders the departments inside each division (the divisions keep their order).
 * Staff and SOP counts go from most to fewest.
 */
export const DIVISION_SORTS = [
  'default',
  'division-name-asc', 'division-name-desc', 'division-staff-desc', 'division-sops-desc',
  'department-name-asc', 'department-name-desc', 'department-staff-desc', 'department-sops-desc',
] as const
export type DivisionSort = (typeof DIVISION_SORTS)[number]
/** The group each sort is listed under in the Sort menu ('default' has none). */
export const sortGroup = (sort: DivisionSort): 'divisions' | 'departments' | undefined =>
  sort.startsWith('division-') ? 'divisions' : sort.startsWith('department-') ? 'departments' : undefined

export interface HierarchyOptions {
  /** Division ids to show (any of them); empty or missing shows every division. */
  divisions?: string[]
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
  const selected = new Set(options.divisions ?? [])
  const rows = snapshot.divisions.map((division) => {
    const children = snapshot.departments.filter((department) => department.division_id === division.id)
    const match = division.name.toLowerCase().includes(search)
    return { division, children: children.filter((child) => match || child.name.toLowerCase().includes(search)),
      // Prefer the server's totals (distinct people); fall back to summing every child row.
      departmentCount: division.department_count ?? children.length,
      employees: division.employees ?? children.reduce((sum, row) => sum + row.employees, 0),
      sops: division.sops ?? children.reduce((sum, row) => sum + row.sops, 0), matches: match || children.some((child) => child.name.toLowerCase().includes(search)) }
  }).filter((row) => row.matches && (!selected.size || selected.has(row.division.id)))
  return sortRows(rows, options.sort ?? 'default')
}

/** Orders the rows (or each row's departments); equal values fall back to the name, then the id, so the order is always the same. */
function sortRows<T extends { division: { name: string; id: string }; employees: number; sops: number; children: { name: string; id: string; employees: number; sops: number }[] }>(rows: T[], sort: DivisionSort): T[] {
  if (sort === 'default') return rows
  type Item = { name: string; id: string; employees: number; sops: number }
  const orders: Record<'name-asc' | 'name-desc' | 'staff-desc' | 'sops-desc', (a: Item, b: Item) => number> = {
    'name-asc': byName,
    'name-desc': (a, b) => -byName(a, b),
    'staff-desc': (a, b) => b.employees - a.employees || byName(a, b),
    'sops-desc': (a, b) => b.sops - a.sops || byName(a, b),
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
