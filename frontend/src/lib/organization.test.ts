import { describe, expect, it } from 'vitest'
import type { Permission } from '../data/mock/types'
import type { OrganizationEmployee, OrganizationHierarchy } from '../services/organization'
import { departmentFilterGroups, isFiltering, overflows, matchesRoles, matchesSearch, organizationRows, OTHERS_FILTER, UNASSIGNED_GROUP_ID, type OrganizationFilters } from './organization'

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
  it('sorts divisions only, keeping the unassigned group last', () => {
    expect(rows({}, 'name-desc').map((row) => row.id)).toEqual(['qual', 'ops', 'empty', UNASSIGNED_GROUP_ID])
    expect(rows({}, 'departments-desc').map((row) => row.id)).toEqual(['ops', 'qual', 'empty', UNASSIGNED_GROUP_ID])
    expect(rows({}, 'departments-asc').map((row) => row.id)).toEqual(['empty', 'qual', 'ops', UNASSIGNED_GROUP_ID])
    expect(rows({}, 'name-asc').find((row) => row.id === 'ops')!.departments.map((d) => d.department.id)).toEqual(['pv', 'reg'])
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
