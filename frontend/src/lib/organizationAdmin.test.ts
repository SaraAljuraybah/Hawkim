import { describe, expect, it } from 'vitest'
import type { ManagedDepartment, ManagementSnapshot } from '../services/organizationAdmin'
import { DIVISION_SORTS, hierarchyRows, departmentDeleteBlocker, managementFilterData, unassignedRows } from './organizationAdmin'

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
    ['division-name-asc', ['administration', 'Beta', 'Clinical Research & Development', 'Quality & Compliance']],
    ['division-name-desc', ['Quality & Compliance', 'Clinical Research & Development', 'Beta', 'administration']],
    // Most staff first (server totals: Quality 7, Clinical 2, administration 1, Beta 0).
    ['division-staff-desc', ['Quality & Compliance', 'Clinical Research & Development', 'administration', 'Beta']],
    // Most SOPs first; ties (administration and Quality both 4) fall back to the name.
    ['division-sops-desc', ['Clinical Research & Development', 'administration', 'Quality & Compliance', 'Beta']],
  ] as const)('%s', (sort, expected) => {
    expect(names(hierarchyRows(snapshot, '', { sort }))).toEqual(expected)
  })

  it('offers the default order, then four division sorts and four department sorts', () => {
    expect(DIVISION_SORTS).toEqual([
      'default',
      'division-name-asc', 'division-name-desc', 'division-staff-desc', 'division-sops-desc',
      'department-name-asc', 'department-name-desc', 'department-staff-desc', 'department-sops-desc',
    ])
  })

  it('orders the departments inside each division, keeping the divisions in their order', () => {
    const quality = (sort: Parameters<typeof hierarchyRows>[2]) => hierarchyRows(snapshot, '', sort)[0].children.map((row) => row.id)
    expect(names(hierarchyRows(snapshot, '', { sort: 'department-name-desc' }))).toEqual(names(hierarchyRows(snapshot)))
    expect(quality({ sort: 'department-name-asc' })).toEqual(['qa', 'qc'])
    expect(quality({ sort: 'department-name-desc' })).toEqual(['qc', 'qa'])
    expect(quality({ sort: 'department-staff-desc' })).toEqual(['qa', 'qc'])
    expect(quality({ sort: 'department-sops-desc' })).toEqual(['qa', 'qc'])
  })

  it('sorts by the server totals, not by the rows shown, and never changes them', () => {
    // Searching "operations" shows one Clinical department, but its totals stay the server's (3 departments, 9 SOPs).
    const [clinical] = hierarchyRows(snapshot, 'operations', { sort: 'division-sops-desc' })
    expect(clinical).toMatchObject({ departmentCount: 3, employees: 2, sops: 9 })
    expect(clinical.children.map((row) => row.id)).toEqual(['co'])
  })

  it('is deterministic for equal names too (falls back to the id)', () => {
    const twins: ManagementSnapshot = { departments: [], divisions: [
      { id: 'z', name: 'Same', description: '', email: null, updated_at: null }, { id: 'y', name: 'same', description: '', email: null, updated_at: null }] }
    expect(hierarchyRows(twins, '', { sort: 'division-name-asc' }).map((row) => row.division.id)).toEqual(['y', 'z'])
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
    expect(names(hierarchyRows(snapshot, 'quality', { divisions: ['c', 'q'], sort: 'division-name-asc' }))).toEqual(['Quality & Compliance'])
    expect(names(hierarchyRows(snapshot, 'o', { divisions: ['c', 'q', 'a'], sort: 'division-sops-desc' }))).toEqual(['Clinical Research & Development', 'administration', 'Quality & Compliance'])
    expect(hierarchyRows(snapshot, 'clinical', { divisions: ['q'] })).toEqual([])
  })
})

describe('filtering by department (the linked rule of every list page)', () => {
  const withUnassigned: ManagementSnapshot = { ...snapshot, departments: [...snapshot.departments, department('old', 'Legacy', null), department('lost', 'Lost', 'gone')] }
  const children = (rows: ReturnType<typeof hierarchyRows>) => rows.map((row) => [row.division.id, row.children.map((child) => child.id), row.picked])

  it('shows only the divisions of the chosen departments, listing only those departments, opened', () => {
    expect(children(hierarchyRows(snapshot, '', { departments: ['qc', 'co'] }))).toEqual([['q', ['qc'], true], ['c', ['co'], true]])
  })

  it('keeps all the departments of a chosen division without any chosen (division-only works as before)', () => {
    expect(children(hierarchyRows(snapshot, '', { divisions: ['q', 'c'], departments: ['co'] }))).toEqual([['q', ['qa', 'qc'], false], ['c', ['co'], true]])
    expect(children(hierarchyRows(snapshot, '', { divisions: ['q'] }))).toEqual([['q', ['qa', 'qc'], false]])
  })

  it('keeps every count per row: the division totals, not just the departments listed', () => {
    const [quality] = hierarchyRows(snapshot, '', { departments: ['qc'] })
    expect([quality.departmentCount, quality.employees, quality.sops]).toEqual([2, 7, 4])
  })

  it('searches and sorts only the departments listed', () => {
    expect(children(hierarchyRows(snapshot, 'assurance', { departments: ['qc'] }))).toEqual([])
    expect(children(hierarchyRows(snapshot, 'quality', { departments: ['qc'] }))).toEqual([['q', ['qc'], true]])
    expect(children(hierarchyRows(snapshot, '', { divisions: ['q'], sort: 'department-name-desc' }))).toEqual([['q', ['qc', 'qa'], false]])
    expect(names(hierarchyRows(snapshot, '', { departments: ['qa', 'co'], sort: 'division-name-asc' }))).toEqual(['Clinical Research & Development', 'Quality & Compliance'])
  })

  it('lists the departments without a division: all, none with divisions only, only the chosen ones with departments', () => {
    expect(unassignedRows(withUnassigned).map((row) => row.id)).toEqual(['old', 'lost'])
    expect(unassignedRows(withUnassigned, 'leg').map((row) => row.id)).toEqual(['old'])
    expect(unassignedRows(withUnassigned, '', { divisions: ['q'] })).toEqual([])
    expect(unassignedRows(withUnassigned, '', { departments: ['lost', 'qa'] }).map((row) => row.id)).toEqual(['lost'])
    // Only unassigned departments chosen: no division row.
    expect(hierarchyRows(withUnassigned, '', { departments: ['old'] })).toEqual([])
  })

  it('offers every division, even one without departments, and every department with its division', () => {
    const data = managementFilterData(withUnassigned)
    expect(data.divisions.map((division) => division.id)).toEqual(['q', 'c', 'a', 'b'])
    expect(data.departments.find((row) => row.id === 'old')).toEqual({ id: 'old', name: 'Legacy', divisionId: null })
  })
})

describe('when a department can be deleted', () => {
  const department = (employees: number, sops: number, deletion_job_id: string | null = null) => ({ employees, sops, deletion_job_id })
  it('can be deleted with no employees and no SOPs', () => {
    expect(departmentDeleteBlocker(department(0, 0))).toBeUndefined()
  })
  it('is blocked by employees or by SOPs; with both, employees are reported', () => {
    expect(departmentDeleteBlocker(department(2, 0))).toBe('employees')
    expect(departmentDeleteBlocker(department(0, 1))).toBe('sops')
    expect(departmentDeleteBlocker(department(2, 1))).toBe('employees')
  })
  it('never blocks the retry of a deletion confirmed earlier because of SOPs', () => {
    expect(departmentDeleteBlocker(department(0, 0, 'job'))).toBeUndefined()
    expect(departmentDeleteBlocker(department(0, 3, 'job'))).toBeUndefined()
  })
})
