import type { ManagedDepartment, ManagementSnapshot } from '../services/organizationAdmin'

/** How the division rows are ordered; 'default' keeps the server's order. */
export const DIVISION_SORTS = ['default', 'name-asc', 'name-desc', 'departments-desc', 'departments-asc', 'sops-desc', 'sops-asc'] as const
export type DivisionSort = (typeof DIVISION_SORTS)[number]

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

/** Orders division rows; equal values fall back to the name, then the id, so the order is always the same. */
function sortRows<T extends { division: { name: string; id: string }; departmentCount: number; sops: number }>(rows: T[], sort: DivisionSort): T[] {
  if (sort === 'default') return rows
  const name = (a: T, b: T) => byName(a.division, b.division)
  const compare: Record<Exclude<DivisionSort, 'default'>, (a: T, b: T) => number> = {
    'name-asc': name,
    'name-desc': (a, b) => -name(a, b),
    'departments-desc': (a, b) => b.departmentCount - a.departmentCount || name(a, b),
    'departments-asc': (a, b) => a.departmentCount - b.departmentCount || name(a, b),
    'sops-desc': (a, b) => b.sops - a.sops || name(a, b),
    'sops-asc': (a, b) => a.sops - b.sops || name(a, b),
  }
  return [...rows].sort(compare[sort])
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
