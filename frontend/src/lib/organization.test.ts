import { describe, expect, it } from 'vitest'
import type { Permission } from '../data/mock/types'
import type { OrganizationEmployee, OrganizationHierarchy } from '../services/organization'
import { departmentFilterGroups, isFiltering, matchesDivisionDepartmentFilter, overflows, matchesRoles, matchesSearch, ORGANIZATION_SORTS, organizationRows, organizationSortGroup, OTHERS_FILTER, UNASSIGNED_GROUP_ID, type OrganizationFilters, type OrganizationSort } from './organization'

const person = (id: string, name: string, permissions: Permission[] = [], email = `${id}@test.invalid`): OrganizationEmployee =>
  ({ id, name, initials: 'XX', email, permissions })
const sara = person('sara', 'Sara Ahmed', ['author'])
const noura = person('noura', 'Noura Alqahtani', ['author', 'reviewer'])
const huda = person('huda', 'Huda Alotaibi', ['reviewer'])
const reem = person('reem', 'Reem Saleh', ['approver'])
const lama = person('lama', 'Lama Fahad')

const hierarchy: OrganizationHierarchy = {
  organization: null,
  divisions: [
    { id: 'ops', name: 'Operations', email: 'ops-team@test.invalid' },
    { id: 'qual', name: 'Quality Division', email: null },
    { id: 'empty', name: 'Empty Division' },
  ],
  departments: [
    { id: 'pv', name: 'Pharmacovigilance', divisionId: 'ops', email: 'pv@test.invalid', employees: [sara, noura] },
    { id: 'reg', name: 'Regulatory Affairs', divisionId: 'ops', email: null, employees: [huda] },
    { id: 'qa', name: 'Quality Assurance', divisionId: 'qual', employees: [reem, lama] },
    { id: 'legacy', name: 'Legacy Unit', divisionId: null, employees: [] },
  ],
}
const none: OrganizationFilters = { query: '', divisions: [], departments: [], roles: [] }
const rows = (filters: Partial<OrganizationFilters> = {}, sort?: Parameters<typeof organizationRows>[2]) => organizationRows(hierarchy, { ...none, ...filters }, sort)
/** division id → { open, departments: department id → { open, staff ids } } */
const shape = (filters: Partial<OrganizationFilters> = {}) => Object.fromEntries(rows(filters).map((row) => [row.id, {
  open: row.autoOpen,
  departments: Object.fromEntries(row.departments.map((d) => [d.department.id, { open: d.autoOpen, staff: d.staff.map((s) => s.id) }])),
}]))

describe('search and role matching', () => {
  it('searches the name or the email, ignoring case and surrounding spaces', () => {
    expect(matchesSearch(sara, '  AHMED ')).toBe(true)
    expect(matchesSearch(sara, 'sara@test')).toBe(true)
    expect(matchesSearch({ name: 'A', email: null }, 'x')).toBe(false)
    expect(matchesSearch(sara, '')).toBe(true)
  })
  it('matches ANY selected role; "Others" means no Author, Reviewer or Approver role', () => {
    expect(matchesRoles(noura, ['reviewer'])).toBe(true)
    expect(matchesRoles(sara, ['reviewer', 'approver'])).toBe(false)
    expect(matchesRoles(lama, [OTHERS_FILTER])).toBe(true)
    expect(matchesRoles(reem, [OTHERS_FILTER])).toBe(false)
    expect(matchesRoles(reem, [])).toBe(true)
  })
  it('counts only a non-blank search or a selection as filtering', () => {
    expect(isFiltering(none)).toBe(false)
    expect(isFiltering({ ...none, query: '   ' })).toBe(false)
    expect(isFiltering({ ...none, roles: ['author'] })).toBe(true)
    expect(isFiltering({ ...none, departments: ['qa'] })).toBe(true)
  })
})

describe('organization rows', () => {
  it('lists every division, then the unassigned group, with everything and nothing opened', () => {
    const all = rows()
    expect(all.map((row) => row.id)).toEqual(['ops', 'qual', 'empty', UNASSIGNED_GROUP_ID])
    expect(all.every((row) => !row.autoOpen && row.departments.every((d) => !d.autoOpen))).toBe(true)
    expect(all[0].departmentCount).toBe(2)
    expect(all[0].email).toBe('ops-team@test.invalid')
    expect(all[2].email).toBeNull()
    expect(all[3]).toMatchObject({ unassigned: true, departmentCount: 1 })
  })
  it('has no unassigned group when every department has a division', () => {
    const data = { ...hierarchy, departments: hierarchy.departments.filter((d) => d.divisionId) }
    expect(organizationRows(data, none).map((row) => row.id)).toEqual(['ops', 'qual', 'empty'])
  })
  it('staff match: shows only that person, with their department and division opened', () => {
    expect(shape({ query: 'huda' })).toEqual({ ops: { open: true, departments: { reg: { open: true, staff: ['huda'] } } } })
    expect(shape({ query: 'noura@test' })).toEqual({ ops: { open: true, departments: { pv: { open: true, staff: ['noura'] } } } })
  })
  it('department match: shows it, closed, with all its staff, under its opened division', () => {
    expect(shape({ query: 'regulatory' })).toEqual({ ops: { open: true, departments: { reg: { open: false, staff: ['huda'] } } } })
    expect(shape({ query: 'pv@test' })).toEqual({ ops: { open: true, departments: { pv: { open: false, staff: ['sara', 'noura'] } } } })
  })
  it('division match: shows it, closed, with all its departments and staff', () => {
    expect(shape({ query: 'ops-team' })).toEqual({ ops: { open: false, departments: {
      pv: { open: false, staff: ['sara', 'noura'] }, reg: { open: false, staff: ['huda'] } } } })
  })
  it('a matching division also opens down to matching rows inside it', () => {
    // "quality" matches the division and its department: the division opens, the department stays closed.
    expect(shape({ query: 'quality' })).toEqual({ qual: { open: true, departments: { qa: { open: false, staff: ['reem', 'lama'] } } } })
  })
  it('searches departments in the unassigned group, but never the group label', () => {
    expect(shape({ query: 'legacy' })).toEqual({ [UNASSIGNED_GROUP_ID]: { open: true, departments: { legacy: { open: false, staff: [] } } } })
    expect(shape({ query: 'unassigned' })).toEqual({})
  })
  it('role filter: only staff with a selected role, opened down to them', () => {
    expect(shape({ roles: ['reviewer'] })).toEqual({ ops: { open: true, departments: {
      pv: { open: true, staff: ['noura'] }, reg: { open: true, staff: ['huda'] } } } })
    expect(shape({ roles: [OTHERS_FILTER] })).toEqual({ qual: { open: true, departments: { qa: { open: true, staff: ['lama'] } } } })
  })
  it('combines the role filter with the search', () => {
    expect(shape({ query: 'operations', roles: ['author'] })).toEqual({ ops: { open: true, departments: { pv: { open: true, staff: ['sara', 'noura'] } } } })
    expect(shape({ query: 'sara', roles: ['reviewer'] })).toEqual({})
  })
  it('division filter: only the selected divisions, closed, never the unassigned group', () => {
    expect(shape({ divisions: ['empty', 'qual'] })).toEqual({
      qual: { open: false, departments: { qa: { open: false, staff: ['reem', 'lama'] } } },
      empty: { open: false, departments: {} },
    })
    expect(shape({ divisions: ['qual'], query: 'huda' })).toEqual({})
  })
  it('department filter: only the selected departments, closed, under their opened division', () => {
    expect(shape({ departments: ['reg'] })).toEqual({ ops: { open: true, departments: { reg: { open: false, staff: ['huda'] } } } })
    expect(shape({ departments: ['legacy'] })).toEqual({ [UNASSIGNED_GROUP_ID]: { open: true, departments: { legacy: { open: false, staff: [] } } } })
  })
  it('department filter narrows only its own division; other selected divisions keep all departments (Rule 1)', () => {
    expect(shape({ divisions: ['ops', 'qual'], departments: ['pv'] })).toEqual({
      ops: { open: true, departments: { pv: { open: false, staff: ['sara', 'noura'] } } },
      qual: { open: false, departments: { qa: { open: false, staff: ['reem', 'lama'] } } },
    })
  })
  it('combines the department filter with search and roles', () => {
    expect(shape({ departments: ['pv'], query: 'noura' })).toEqual({ ops: { open: true, departments: { pv: { open: true, staff: ['noura'] } } } })
    expect(shape({ departments: ['pv'], roles: ['reviewer'] })).toEqual({ ops: { open: true, departments: { pv: { open: true, staff: ['noura'] } } } })
    expect(shape({ departments: ['pv'], query: 'huda' })).toEqual({})
    expect(shape({ departments: ['pv'], roles: ['approver'] })).toEqual({})
  })
  it('keeps the totals whatever is filtered', () => {
    expect(rows({ query: 'huda' })[0].departmentCount).toBe(2)
    expect(rows({ query: 'huda' })[0].departments[0].department.employees).toHaveLength(1)
  })
})

describe('sort', () => {
  // Default order: Gamma, Alpha, Beta. Alpha's departments: Zeta (1 staff), Eta (2), Mu (1).
  const sortable: OrganizationHierarchy = {
    organization: null,
    divisions: [{ id: 'g', name: 'Gamma' }, { id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
    departments: [
      { id: 'zeta', name: 'Zeta', divisionId: 'a', employees: [sara] },
      { id: 'eta', name: 'Eta', divisionId: 'a', employees: [noura, huda] },
      { id: 'mu', name: 'Mu', divisionId: 'a', employees: [reem] },
      { id: 'kappa', name: 'Kappa', divisionId: 'b', employees: [] },
      { id: 'iota', name: 'Iota', divisionId: 'g', employees: [] },
      { id: 'omega', name: 'Omega', divisionId: null, employees: [] },
      { id: 'beta-unit', name: 'Beta Unit', divisionId: null, employees: [lama] },
    ],
  }
  const sorted = (sort: OrganizationSort) => organizationRows(sortable, none, sort)
  const divisionOrder = (sort: OrganizationSort) => sorted(sort).map((row) => row.id)
  const departmentOrder = (sort: OrganizationSort, divisionId: string) =>
    sorted(sort).find((row) => row.id === divisionId)!.departments.map((row) => row.department.id)

  it('lists Default order, then division name and departments, department name and staff, each both ways in its group', () => {
    expect(ORGANIZATION_SORTS).toEqual([
      'default',
      'division-name-asc', 'division-name-desc',
      'division-departments-desc', 'division-departments-asc',
      'department-name-asc', 'department-name-desc',
      'department-staff-desc', 'department-staff-asc',
    ])
    expect(ORGANIZATION_SORTS.map(organizationSortGroup)).toEqual([
      undefined, 'division-name', 'division-name', 'division-departments', 'division-departments',
      'department-name', 'department-name', 'department-staff', 'department-staff',
    ])
  })
  it('keeps the loaded order by default', () => {
    expect(divisionOrder('default')).toEqual(['g', 'a', 'b', UNASSIGNED_GROUP_ID])
    expect(departmentOrder('default', 'a')).toEqual(['zeta', 'eta', 'mu'])
  })
  it('orders the divisions by name, keeping their departments and the unassigned group last', () => {
    expect(divisionOrder('division-name-asc')).toEqual(['a', 'b', 'g', UNASSIGNED_GROUP_ID])
    expect(divisionOrder('division-name-desc')).toEqual(['g', 'b', 'a', UNASSIGNED_GROUP_ID])
    expect(departmentOrder('division-name-asc', 'a')).toEqual(['zeta', 'eta', 'mu'])
    expect(departmentOrder('division-name-asc', UNASSIGNED_GROUP_ID)).toEqual(['omega', 'beta-unit'])
  })
  it('orders the divisions by number of departments, most first, ties by name', () => {
    // Beta and Gamma both have one department: Beta first, although Gamma comes first by default.
    expect(divisionOrder('division-departments-desc')).toEqual(['a', 'b', 'g', UNASSIGNED_GROUP_ID])
  })
  it('orders the divisions by number of departments, fewest first, ties still by name A to Z', () => {
    // Beta and Gamma (one each) before Alpha (three); Beta before Gamma by name. The unassigned group stays last.
    expect(divisionOrder('division-departments-asc')).toEqual(['b', 'g', 'a', UNASSIGNED_GROUP_ID])
  })
  it('orders the departments inside each division by name, the divisions keeping their order', () => {
    expect(divisionOrder('department-name-asc')).toEqual(['g', 'a', 'b', UNASSIGNED_GROUP_ID])
    expect(departmentOrder('department-name-asc', 'a')).toEqual(['eta', 'mu', 'zeta'])
    expect(departmentOrder('department-name-asc', UNASSIGNED_GROUP_ID)).toEqual(['beta-unit', 'omega'])
    expect(divisionOrder('department-name-desc')).toEqual(['g', 'a', 'b', UNASSIGNED_GROUP_ID])
    expect(departmentOrder('department-name-desc', 'a')).toEqual(['zeta', 'mu', 'eta'])
  })
  it('orders the departments inside each division by number of staff, most first, ties by name', () => {
    expect(divisionOrder('department-staff-desc')).toEqual(['g', 'a', 'b', UNASSIGNED_GROUP_ID])
    // Mu and Zeta both have one person: Mu first, although Zeta comes first by default.
    expect(departmentOrder('department-staff-desc', 'a')).toEqual(['eta', 'mu', 'zeta'])
    expect(departmentOrder('department-staff-desc', UNASSIGNED_GROUP_ID)).toEqual(['beta-unit', 'omega'])
  })
  it('orders the departments inside each division by number of staff, fewest first, ties still by name A to Z', () => {
    expect(divisionOrder('department-staff-asc')).toEqual(['g', 'a', 'b', UNASSIGNED_GROUP_ID])
    // Mu and Zeta (one each) before Eta (two); Mu before Zeta by name.
    expect(departmentOrder('department-staff-asc', 'a')).toEqual(['mu', 'zeta', 'eta'])
    expect(departmentOrder('department-staff-asc', UNASSIGNED_GROUP_ID)).toEqual(['omega', 'beta-unit'])
  })
  it('keeps the staff inside a department in their order', () => {
    for (const sort of ORGANIZATION_SORTS) {
      const eta = sorted(sort).find((row) => row.id === 'a')!.departments.find((row) => row.department.id === 'eta')!
      expect(eta.staff.map((person) => person.id)).toEqual(['noura', 'huda'])
    }
  })
  it('falls back to the id when names are the same', () => {
    const twins: OrganizationHierarchy = { organization: null, divisions: [{ id: 'd2', name: 'Same' }, { id: 'd1', name: 'same' }], departments: [] }
    expect(organizationRows(twins, none, 'division-name-asc').map((row) => row.id)).toEqual(['d1', 'd2'])
    expect(organizationRows(twins, none, 'division-departments-desc').map((row) => row.id)).toEqual(['d1', 'd2'])
  })
})

describe('department filter chips', () => {
  it('groups departments by division A to Z, skipping empty divisions, then the unassigned ones', () => {
    expect(departmentFilterGroups(hierarchy, []).map((group) => [group.id, group.label, group.options.map((option) => option.label)])).toEqual([
      ['ops', 'Operations', ['Pharmacovigilance', 'Regulatory Affairs']],
      ['qual', 'Quality Division', ['Quality Assurance']],
      [UNASSIGNED_GROUP_ID, '', ['Legacy Unit']],
    ])
  })
  it('offers only the departments of the selected divisions, never the unassigned ones', () => {
    expect(departmentFilterGroups(hierarchy, ['qual']).map((group) => group.id)).toEqual(['qual'])
  })
})

describe('staff scroll box', () => {
  it('is scrollable only when its content is taller than the box', () => {
    expect(overflows(600, 360)).toBe(true)
    expect(overflows(360, 360)).toBe(false)
    expect(overflows(361, 360)).toBe(false)
    expect(overflows(200, 200)).toBe(false)
  })
})

describe('Division and Department filter together (Rule 1, the admin SOP Directory)', () => {
  const group: Record<string, string> = { pv: 'ops', reg: 'ops', qa: 'qual', legacy: UNASSIGNED_GROUP_ID }
  const match = (department: string, divisions: string[], departments: string[]) =>
    matchesDivisionDepartmentFilter(department, divisions, departments, (id) => group[id] ?? UNASSIGNED_GROUP_ID)
  it('matches everything when nothing is selected', () => {
    for (const department of ['pv', 'qa', 'legacy']) expect(match(department, [], [])).toBe(true)
  })
  it('keeps every department of a selected division without selected departments', () => {
    expect(match('pv', ['ops'], [])).toBe(true)
    expect(match('reg', ['ops'], [])).toBe(true)
    expect(match('qa', ['ops'], [])).toBe(false)
    expect(match('legacy', ['ops'], [])).toBe(false)
  })
  it('narrows only the division whose departments are selected', () => {
    expect(match('pv', ['ops', 'qual'], ['pv'])).toBe(true)
    expect(match('reg', ['ops', 'qual'], ['pv'])).toBe(false)
    expect(match('qa', ['ops', 'qual'], ['pv'])).toBe(true)
  })
  it('shows selected departments without their division selected, and unassigned ones when picked', () => {
    expect(match('reg', [], ['reg'])).toBe(true)
    expect(match('pv', [], ['reg'])).toBe(false)
    expect(match('legacy', [], ['legacy'])).toBe(true)
  })
})

describe('Organizational Structure keeps its Department chips', () => {
  it('gives the same groups from its hierarchy as before (the widened input type)', () => {
    expect(departmentFilterGroups(hierarchy, ['ops']).map((g) => [g.id, g.options.map((o) => o.value)])).toEqual([['ops', ['pv', 'reg']]])
    expect(departmentFilterGroups(hierarchy, []).map((g) => g.id)).toEqual(['ops', 'qual', UNASSIGNED_GROUP_ID])
  })
})
