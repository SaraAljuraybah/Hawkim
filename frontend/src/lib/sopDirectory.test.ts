import { describe, expect, it } from 'vitest'
import type { Department, Sop } from '../data/mock/types'
import { sops } from '../data/mock/sops'
import { ALL_DEPARTMENTS, filterDirectorySops, recentSince } from './sopDirectory'
import { NO_DIVISION } from './userAdmin'

const base = sops[0]
const items: Sop[] = [
  { ...base, id: 'one', code: 'SOP-002', title: 'Document Control', departmentId: 'information-technology', status: 'published', fileType: 'pdf', lastUpdated: '2026-10-01' },
  { ...base, id: 'two', code: 'SOP-010', title: 'Access Control', departmentId: 'information-technology', status: 'published', fileType: 'docx', lastUpdated: '2026-10-15' },
  { ...base, id: 'draft', code: 'SOP-003', title: 'Draft Control', departmentId: 'information-technology', status: 'draft' },
  { ...base, id: 'returned', code: 'SOP-004', title: 'Returned Control', departmentId: 'information-technology', status: 'returned' },
  { ...base, id: 'other', code: 'SOP-005', title: 'Other Department Control', departmentId: 'quality-assurance', status: 'published' },
]
const ids = (result: Sop[]) => result.map((sop) => sop.id)

describe('SOP directory search and filters', () => {
  it('searches codes and titles using case-insensitive partial matches', () => {
    expect(ids(filterDirectorySops(items, 'information-technology', '  sOp-00  '))).toEqual(['one'])
    expect(ids(filterDirectorySops(items, 'information-technology', 'CONTROL'))).toEqual(['two', 'one'])
    expect(ids(filterDirectorySops(items, 'information-technology', 'access'))).toEqual(['two'])
  })
  it('lists PDF and Word SOPs together: there is no file type filter', () => {
    expect(ids(filterDirectorySops(items, 'information-technology', 'control'))).toEqual(['two', 'one'])
    expect(items.find((item) => item.id === 'one')?.fileType).toBe('pdf')
    expect(items.find((item) => item.id === 'two')?.fileType).toBe('docx')
  })
  it('never expands visibility to unpublished SOPs or another department', () => {
    expect(filterDirectorySops(items, 'information-technology', 'Draft')).toEqual([])
    expect(filterDirectorySops(items, 'information-technology', 'Returned')).toEqual([])
    expect(filterDirectorySops(items, 'information-technology', 'Other')).toEqual([])
    expect(ids(filterDirectorySops(items, 'quality-assurance', 'control'))).toEqual(['other'])
  })
  it('sorts by the date on the card, newest first by default, without mutating the source array', () => {
    const before = structuredClone(items)
    expect(ids(filterDirectorySops(items, 'information-technology'))).toEqual(['two', 'one'])
    expect(ids(filterDirectorySops(items, 'information-technology', '', 'newest'))).toEqual(['two', 'one'])
    expect(ids(filterDirectorySops(items, 'information-technology', '', 'oldest'))).toEqual(['one', 'two'])
    expect(items).toEqual(before)
  })
  it('applies the sort order to search results', () => {
    const more: Sop[] = [...items, { ...items[0], id: 'three', code: 'SOP-020', title: 'Control Log', lastUpdated: '2026-10-20' }]
    expect(ids(filterDirectorySops(more, 'information-technology', 'control', 'newest'))).toEqual(['three', 'two', 'one'])
    expect(ids(filterDirectorySops(more, 'information-technology', 'control', 'oldest'))).toEqual(['one', 'two', 'three'])
  })
  it('keeps SOPs with the same date in code order in both directions', () => {
    const sameDate = [{ ...items[1], lastUpdated: '2026-10-01' }, items[0]]
    expect(ids(filterDirectorySops(sameDate, 'information-technology', '', 'newest'))).toEqual(['one', 'two'])
    expect(ids(filterDirectorySops(sameDate, 'information-technology', '', 'oldest'))).toEqual(['one', 'two'])
  })
})

describe('the System Admin directory: every department, Filter by Division and Filter by Department', () => {
  const others = { ...items[4], id: 'others', directoryGroup: 'others' as const }

  it('shows every department\'s published SOPs, never Others or unpublished ones', () => {
    expect(ids(filterDirectorySops([...items, others], ALL_DEPARTMENTS)).sort()).toEqual(['one', 'other', 'two'])
  })

  it('keeps only the checked departments, with search and sort; none checked means every department', () => {
    expect(ids(filterDirectorySops(items, ALL_DEPARTMENTS, '', 'newest', { departments: ['quality-assurance'] }))).toEqual(['other'])
    expect(ids(filterDirectorySops(items, ALL_DEPARTMENTS, 'access', 'newest', { departments: ['information-technology', 'quality-assurance'] }))).toEqual(['two'])
    expect(filterDirectorySops(items, ALL_DEPARTMENTS, '', 'newest', { departments: [] })).toHaveLength(3)
  })

  // IT is in the Technology division; Quality Assurance has none.
  const departments: Record<string, Pick<Department, 'divisionId'>> = { 'information-technology': { divisionId: 'technology' }, 'quality-assurance': {} }
  const getDepartment = (id: string) => departments[id]

  it('keeps only the selected divisions; departments without one are never a division; none selected means every division', () => {
    expect(ids(filterDirectorySops(items, ALL_DEPARTMENTS, '', 'newest', { divisions: ['technology'], getDepartment }))).toEqual(['two', 'one'])
    // The removed "No Division" choice matches nothing (the page drops it from old links).
    expect(filterDirectorySops(items, ALL_DEPARTMENTS, '', 'newest', { divisions: [NO_DIVISION], getDepartment })).toEqual([])
    expect(filterDirectorySops(items, ALL_DEPARTMENTS, '', 'newest', { divisions: [], getDepartment })).toHaveLength(3)
  })

  it('combines divisions and departments with Rule 1: selected departments narrow only their own division', () => {
    // A department selected in the division: only it.
    expect(ids(filterDirectorySops(items, ALL_DEPARTMENTS, '', 'newest', { divisions: ['technology'], getDepartment, departments: ['information-technology'] }))).toEqual(['two', 'one'])
    // An unassigned department selected: it shows, and the selected division keeps all its departments.
    expect(ids(filterDirectorySops(items, ALL_DEPARTMENTS, '', 'newest', { divisions: ['technology'], getDepartment, departments: ['quality-assurance'] })).sort()).toEqual(['one', 'other', 'two'])
    // Departments only: just those.
    expect(ids(filterDirectorySops(items, ALL_DEPARTMENTS, '', 'newest', { getDepartment, departments: ['quality-assurance'] }))).toEqual(['other'])
  })
})

describe('Recently Published', () => {
  it('keeps SOPs dated on or after the date three months ago', () => {
    expect(ids(filterDirectorySops(items, 'information-technology', '', 'newest', { since: '2026-10-02' }))).toEqual(['two'])
    expect(ids(filterDirectorySops(items, 'information-technology', '', 'newest', { since: '2026-10-01' }))).toEqual(['two', 'one'])
  })

  it('starts three months before today, on the last day of a shorter month', () => {
    expect(recentSince(new Date(2026, 10, 9))).toBe('2026-08-09')
    expect(recentSince(new Date(2026, 0, 15))).toBe('2025-10-15')
    expect(recentSince(new Date(2026, 4, 31))).toBe('2026-02-28')
  })
})
