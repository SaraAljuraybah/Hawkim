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
    expect(ids(filterDirectorySops(items, 'information-technology', 'all', '  sOp-00  '))).toEqual(['one'])
    expect(ids(filterDirectorySops(items, 'information-technology', 'all', 'CONTROL'))).toEqual(['one', 'two'])
    expect(ids(filterDirectorySops(items, 'information-technology', 'all', 'access'))).toEqual(['two'])
  })
  it('combines search with PDF and Word filters and allows clearing both', () => {
    expect(ids(filterDirectorySops(items, 'information-technology', 'all', 'control', 'pdf'))).toEqual(['one'])
    expect(ids(filterDirectorySops(items, 'information-technology', 'recent', 'control', 'docx'))).toEqual(['two'])
    expect(filterDirectorySops(items, 'information-technology', 'all', 'access', 'pdf')).toEqual([])
    expect(ids(filterDirectorySops(items, 'information-technology', 'all', '', 'all'))).toEqual(['one', 'two'])
  })
  it('never expands visibility to unpublished SOPs or another department', () => {
    expect(filterDirectorySops(items, 'information-technology', 'all', 'Draft')).toEqual([])
    expect(filterDirectorySops(items, 'information-technology', 'recent', 'Returned')).toEqual([])
    expect(filterDirectorySops(items, 'information-technology', 'all', 'Other')).toEqual([])
    expect(ids(filterDirectorySops(items, 'quality-assurance', 'all', 'control'))).toEqual(['other'])
  })
  it('retains tab ordering without mutating the source array', () => {
    const before = structuredClone(items)
    expect(ids(filterDirectorySops(items, 'information-technology', 'all'))).toEqual(['one', 'two'])
    expect(ids(filterDirectorySops(items, 'information-technology', 'recent'))).toEqual(['two', 'one'])
    expect(items).toEqual(before)
  })
})
