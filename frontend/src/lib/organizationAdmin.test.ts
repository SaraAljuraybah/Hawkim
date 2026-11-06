import { describe, expect, it } from 'vitest'
import type { ManagedDepartment, ManagementSnapshot } from '../services/organizationAdmin'
import { DIVISION_SORTS, hierarchyRows } from './organizationAdmin'

const department = (id: string, name: string, division: string | null, employees = 0, sops = 0): ManagedDepartment =>
  ({ id, name, initials: 'XX', description: '', division_id: division, updated_at: 'r', employees, sops, status_counts: {}, people: [] })

// Server order (the default): Quality, Clinical, Admin, Beta. Server totals differ from the visible rows on purpose.
const snapshot: ManagementSnapshot = {
  divisions: [
    { id: 'q', name: 'Quality & Compliance', description: '', email: null, updated_at: null, department_count: 2, employees: 7, sops: 4 },
    { id: 'c', name: 'Clinical Research & Development', description: '', email: null, updated_at: null, department_count: 3, employees: 2, sops: 9 },
    { id: 'a', name: 'administration', description: '', email: null, updated_at: null, department_count: 1, employees: 1, sops: 4 },
    { id: 'b', name: 'Beta', description: '', email: null, updated_at: null, department_count: 3, employees: 0, sops: 0 },
  ],
  departments: [
    department('qa', 'Quality Assurance', 'q', 4, 3), department('qc', 'Quality Control', 'q', 3, 1),
    department('co', 'Clinical Operations', 'c', 2, 9), department('ad', 'Admin Office', 'a', 1, 4),
  ],
}
const names = (rows: ReturnType<typeof hierarchyRows>) => rows.map((row) => row.division.name)

describe('sorting division rows', () => {
  it('keeps the server order by default', () => {
    expect(names(hierarchyRows(snapshot))).toEqual(['Quality & Compliance', 'Clinical Research & Development', 'administration', 'Beta'])
    expect(names(hierarchyRows(snapshot, '', { sort: 'default' }))).toEqual(names(hierarchyRows(snapshot)))
  })

  it.each([
    ['name-asc', ['administration', 'Beta', 'Clinical Research & Development', 'Quality & Compliance']],
    ['name-desc', ['Quality & Compliance', 'Clinical Research & Development', 'Beta', 'administration']],
    // Ties (Clinical and Beta both 3) fall back to the name.
    ['departments-desc', ['Beta', 'Clinical Research & Development', 'Quality & Compliance', 'administration']],
    ['departments-asc', ['administration', 'Quality & Compliance', 'Beta', 'Clinical Research & Development']],
    // Ties (Quality and administration both 4) fall back to the name.
    ['sops-desc', ['Clinical Research & Development', 'administration', 'Quality & Compliance', 'Beta']],
    ['sops-asc', ['Beta', 'administration', 'Quality & Compliance', 'Clinical Research & Development']],
  ] as const)('%s', (sort, expected) => {
    expect(names(hierarchyRows(snapshot, '', { sort }))).toEqual(expected)
  })

  it('offers exactly the default order and the six sorts', () => {
    expect(DIVISION_SORTS).toEqual(['default', 'name-asc', 'name-desc', 'departments-desc', 'departments-asc', 'sops-desc', 'sops-asc'])
  })

  it('sorts by the server totals, not by the rows shown, and never changes them', () => {
    // Searching "operations" shows one Clinical department, but its totals stay the server's (3 departments, 9 SOPs).
    const [clinical] = hierarchyRows(snapshot, 'operations', { sort: 'departments-desc' })
    expect(clinical).toMatchObject({ departmentCount: 3, employees: 2, sops: 9 })
    expect(clinical.children.map((row) => row.id)).toEqual(['co'])
  })

  it('is deterministic for equal names too (falls back to the id)', () => {
    const twins: ManagementSnapshot = { departments: [], divisions: [
      { id: 'z', name: 'Same', description: '', email: null, updated_at: null }, { id: 'y', name: 'same', description: '', email: null, updated_at: null }] }
    expect(hierarchyRows(twins, '', { sort: 'name-asc' }).map((row) => row.division.id)).toEqual(['y', 'z'])
  })
})

describe('filtering by division', () => {
  it('shows every division when none is selected', () => {
    expect(hierarchyRows(snapshot, '', { divisions: [] })).toHaveLength(4)
  })

  it('shows any of the selected divisions (OR), with all their departments', () => {
    const rows = hierarchyRows(snapshot, '', { divisions: ['c', 'q'] })
    expect(names(rows)).toEqual(['Quality & Compliance', 'Clinical Research & Development'])
    expect(rows[0].children.map((row) => row.id)).toEqual(['qa', 'qc'])
  })

  it('works together with search and sort', () => {
    expect(names(hierarchyRows(snapshot, 'quality', { divisions: ['c', 'q'], sort: 'name-asc' }))).toEqual(['Quality & Compliance'])
    expect(names(hierarchyRows(snapshot, 'o', { divisions: ['c', 'q', 'a'], sort: 'sops-asc' }))).toEqual(['administration', 'Quality & Compliance', 'Clinical Research & Development'])
    expect(hierarchyRows(snapshot, 'clinical', { divisions: ['q'] })).toEqual([])
  })
})
