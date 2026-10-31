import { describe, expect, it } from 'vitest'
import type { Sop } from '../data/mock/types'
import { sops } from '../data/mock/sops'
import { authoredSopsFor, filterMySops, type MySopCategory } from './mySops'

const items: Sop[] = [
  { ...sops[0], id: 'draft', code: 'SOP-SECRET', title: 'Document Control', authorId: 'me', coAuthorIds: [], departmentId: 'home', status: 'draft', lastUpdated: '2026-10-20' },
  { ...sops[0], id: 'co-draft', title: 'Access Control', authorId: 'other', coAuthorIds: ['me'], departmentId: 'home', status: 'draft', lastUpdated: '2026-10-21T12:00:00Z' },
  ...(['in-review', 'returned', 'in-approval', 'approved', 'published'] as const).map((status) => ({ ...sops[0], id: status, title: `${status} Control`, authorId: 'me', coAuthorIds: [], departmentId: 'home', status, lastUpdated: '2026-10-22' })),
  { ...sops[0], id: 'foreign', title: 'Foreign Control', authorId: 'me', coAuthorIds: [], departmentId: 'foreign', status: 'draft' },
  { ...sops[0], id: 'unowned', title: 'Unowned Control', authorId: 'other', coAuthorIds: [], departmentId: 'home', status: 'draft' },
]
const owned = () => authoredSopsFor(items, 'me', 'home')
const ids = (result: Sop[]) => result.map((sop) => sop.id)

describe('My SOPs presentation filters', () => {
  it('preserves home-department ownership scope and newest-first sorting', () => {
    expect(ids(owned())).not.toContain('foreign')
    expect(ids(owned())).not.toContain('unowned')
    expect(ids(owned()).slice(-2)).toEqual(['co-draft', 'draft'])
  })

  it.each<[MySopCategory, string[]]>([
    ['new', ['co-draft', 'draft']],
    ['progress', ['in-review', 'returned', 'in-approval']],
    ['completed', ['approved', 'published']],
  ])('groups %s without changing the lifecycle statuses', (category, expected) => {
    const before = structuredClone(items)
    expect(ids(filterMySops(owned(), 'me', { category }))).toEqual(expected)
    expect(items).toEqual(before)
  })

  it('searches titles case-insensitively without searching hidden serial codes', () => {
    expect(ids(filterMySops(owned(), 'me', { category: 'new', query: '  DOCUMENT  ' }))).toEqual(['draft'])
    expect(filterMySops(owned(), 'me', { category: 'new', query: 'SOP-SECRET' })).toEqual([])
  })

  it('combines title, exact name, date and ownership filters and supports clearing them', () => {
    expect(ids(filterMySops(owned(), 'me', { category: 'new', query: 'control', sopId: 'co-draft', updatedDate: '2026-10-21', role: 'coauthor' }))).toEqual(['co-draft'])
    expect(filterMySops(owned(), 'me', { category: 'new', sopId: 'co-draft', role: 'main' })).toEqual([])
    expect(filterMySops(owned(), 'me', { category: 'new', updatedDate: '2026-10-22' })).toEqual([])
    expect(ids(filterMySops(owned(), 'me', { category: 'new', role: 'main' }))).toEqual(['draft'])
    expect(ids(filterMySops(owned(), 'me', { category: 'new', query: '', sopId: '', updatedDate: '', role: 'all' }))).toEqual(['co-draft', 'draft'])
  })

  it('keeps filters meaningful across categories', () => {
    expect(ids(filterMySops(owned(), 'me', { category: 'progress', query: 'control', role: 'main', updatedDate: '2026-10-22' }))).toEqual(['in-review', 'returned', 'in-approval'])
    expect(ids(filterMySops(owned(), 'me', { category: 'completed', query: 'control', role: 'main', updatedDate: '2026-10-22' }))).toEqual(['approved', 'published'])
  })
})
