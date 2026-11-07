import { describe, expect, it } from 'vitest'
import type { Sop } from '../data/mock/types'
import { sops } from '../data/mock/sops'
import { filterDirectorySops } from './sopDirectory'

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
