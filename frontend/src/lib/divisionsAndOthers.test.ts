import { describe, expect, it } from 'vitest'
import type { Sop, User } from '../data/mock/types'
import { toDepartment } from '../services/people'
import { getSopAccess } from './sopAccess'
import { filterDirectorySops, OTHERS_SECTION } from './sopDirectory'
import { departmentsInDivision, divisionLabel, divisionNameIn, divisionOptions, NO_DIVISION } from './userAdmin'

const row = { name: 'Dept', initials: 'DP', description: '', is_quality: false, removed_at: null, requires_compliance_check: false }

describe('departments carry their database division', () => {
  it('maps departments.division_id and the division name', () => {
    expect(toDepartment({ ...row, id: 'pv', division_id: 'regulatory_drug_safety', division: { name: 'Regulatory and Drug Safety' } }))
      .toMatchObject({ id: 'pv', divisionId: 'regulatory_drug_safety', divisionName: 'Regulatory and Drug Safety' })
  })
  it('keeps a department without a division unassigned', () => {
    const department = toDepartment({ ...row, id: 'legacy', division_id: null, division: null })
    expect(department.divisionId).toBeUndefined()
    expect(department.divisionName).toBeUndefined()
  })
})

describe('division pickers show names but keep ids as keys', () => {
  const departments = [
    { id: 'a', divisionId: 'z-id', divisionName: 'Alpha Division' },
    { id: 'b', divisionId: 'a-id', divisionName: 'Zulu Division' },
    { id: 'c', divisionId: 'z-id', divisionName: 'Alpha Division' },
    { id: 'd' },
  ]
  it('orders divisions by name, then No Division', () => {
    expect(divisionOptions(departments)).toEqual(['z-id', 'a-id', NO_DIVISION])
  })
  it('labels a division key with its name, falling back to the key', () => {
    expect(divisionNameIn(departments, 'a-id')).toBe('Zulu Division')
    expect(divisionNameIn([{ divisionId: 'only-id' }], 'only-id')).toBe('only-id')
    expect(divisionLabel(departments[0])).toBe('Alpha Division')
  })
  it('groups departments by the same id as before (eligibility is unchanged)', () => {
    expect(departmentsInDivision(departments, 'z-id').map((item) => item.id)).toEqual(['a', 'c'])
    expect(departmentsInDivision(departments, NO_DIVISION).map((item) => item.id)).toEqual(['d'])
  })
})

const user: Pick<User, 'id' | 'departmentId' | 'deletedAt'> = { id: 'reader', departmentId: 'home' }
const sop = (overrides: Partial<Sop>): Sop => ({
  id: 's', code: 'SOP-1', title: 'T', departmentId: 'home', version: '1', status: 'published', lastUpdated: '2026-11-01',
  fileName: 'f.pdf', fileType: 'pdf', authorId: 'author', coAuthorIds: [], reviewers: [], approvers: [], ...overrides,
} as Sop)

describe('SOP Directory > Others', () => {
  it('opens an SOP moved to Others only to its main author and co-authors', () => {
    const moved = sop({ departmentId: 'removed', directoryGroup: 'others', authorId: 'reader' })
    expect(getSopAccess(moved, user, [])).toBe('granted')
    expect(getSopAccess({ ...moved, authorId: 'x', coAuthorIds: ['reader'] }, user, [])).toBe('granted')
    expect(getSopAccess({ ...moved, authorId: 'x' }, user, [])).toBe('locked')
  })
  it('never opens it through the deleted department (membership or approved access)', () => {
    const moved = sop({ departmentId: 'home', directoryGroup: 'others', authorId: 'x' })
    const approved = [{ id: 'r', type: 'department-access', requesterId: 'reader', departmentId: 'home', status: 'approved' }] as never
    expect(getSopAccess(moved, user, approved)).toBe('locked')
    expect(getSopAccess(moved, { ...user, deletedAt: '2026-01-01' }, [])).toBe('locked')
  })
  it('keeps department and Others sections apart', () => {
    const regular = sop({ id: 'regular' })
    const moved = sop({ id: 'moved', directoryGroup: 'others' })
    const draft = sop({ id: 'draft', directoryGroup: 'others', status: 'draft' })
    expect(filterDirectorySops([regular, moved, draft], 'home').map((item) => item.id)).toEqual(['regular'])
    expect(filterDirectorySops([regular, moved, draft], OTHERS_SECTION).map((item) => item.id)).toEqual(['moved'])
  })
  it('uses a section key no department id can take', () => {
    expect(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(OTHERS_SECTION)).toBe(false)
  })
})
