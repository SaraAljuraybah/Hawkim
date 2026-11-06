import type { ManagementSnapshot } from '../services/organizationAdmin'

/** Totals always use all children. Filtering only determines which child rows are displayed. */
export function hierarchyRows(snapshot: ManagementSnapshot, query = '') {
  const search = query.trim().toLowerCase()
  return snapshot.divisions.map((division) => {
    const children = snapshot.departments.filter((department) => department.division_id === division.id)
    const match = division.name.toLowerCase().includes(search)
    return { division, children: children.filter((child) => match || child.name.toLowerCase().includes(search)),
      // Prefer the server's totals (distinct people); fall back to summing every child row.
      departmentCount: division.department_count ?? children.length,
      employees: division.employees ?? children.reduce((sum, row) => sum + row.employees, 0),
      sops: division.sops ?? children.reduce((sum, row) => sum + row.sops, 0), matches: match || children.some((child) => child.name.toLowerCase().includes(search)) }
  }).filter((row) => row.matches)
}
