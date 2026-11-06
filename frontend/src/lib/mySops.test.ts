import { describe, expect, it } from 'vitest'
import type { Sop } from '../data/mock/types'
import { sops } from '../data/mock/sops'
import { authoredSopsFor, canDeleteSop, filterMySops, hasRunningCheck, isSopDeleteErrorCode, mySopTitles, sortMySops, type MySopCategory } from './mySops'

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

  it('combines title and ownership filters and supports clearing them', () => {
    expect(ids(filterMySops(owned(), 'me', { category: 'new', query: 'control', role: 'coauthor' }))).toEqual(['co-draft'])
    expect(filterMySops(owned(), 'me', { category: 'new', query: 'access', role: 'main' })).toEqual([])
    expect(ids(filterMySops(owned(), 'me', { category: 'new', role: 'main' }))).toEqual(['draft'])
    expect(ids(filterMySops(owned(), 'me', { category: 'new', query: '', role: 'all' }))).toEqual(['co-draft', 'draft'])
  })

  it('keeps filters meaningful across categories', () => {
    expect(ids(filterMySops(owned(), 'me', { category: 'progress', query: 'control', role: 'main' }))).toEqual(['in-review', 'returned', 'in-approval'])
    expect(ids(filterMySops(owned(), 'me', { category: 'completed', query: 'control', role: 'main' }))).toEqual(['approved', 'published'])
  })

  it('sorts by last updated date both ways without changing the input', () => {
    const newest = filterMySops(owned(), 'me', { category: 'new' })
    expect(ids(sortMySops(newest, 'newest'))).toEqual(['co-draft', 'draft'])
    expect(ids(sortMySops(newest, 'oldest'))).toEqual(['draft', 'co-draft'])
    expect(ids(newest)).toEqual(['co-draft', 'draft'])
  })

  it('suggests each title once, A to Z', () => {
    const duplicated = [...owned().slice(-2), { ...items[0], id: 'same-title' }]
    expect(mySopTitles(duplicated)).toEqual(['Access Control', 'Document Control'])
  })
})

describe('deleting an SOP from My SOPs', () => {
  it('is only for the main author, in New SOPs and In Progress', () => {
    const deletable = items.filter((sop) => sop.departmentId === 'home' && canDeleteSop(sop, 'me')).map((sop) => sop.id)
    expect(deletable).toEqual(['draft', 'in-review', 'returned', 'in-approval'])
    // Co-authors never; nor anyone while signed out.
    expect(canDeleteSop(items[1], 'me')).toBe(false)
    expect(canDeleteSop({ ...items[0], authorId: '' }, '')).toBe(false)
    // The same statuses as the two tabs.
    const tabs = (['new', 'progress'] as MySopCategory[]).flatMap((category) => ids(filterMySops(owned(), 'me', { category, role: 'main' })))
    expect(tabs.sort()).toEqual([...deletable].sort())
  })

  it('treats a check as running only until it would be left behind, like the database', () => {
    const now = Date.parse('2026-10-29T09:00:00Z')
    const withCheck = (engine: string | undefined, minutesAgo: number, status: 'running' | 'completed' = 'running') => ({
      ...items[0],
      complianceChecks: [{ id: 'c', sopId: 'draft', version: '1', status, engine, startedAt: new Date(now - minutesAgo * 60_000).toISOString(), guideline: { name: 'GVP', version: '4.0' }, findings: [] }],
    })
    expect(hasRunningCheck(withCheck('sample', 4), now)).toBe(true)
    expect(hasRunningCheck(withCheck('sample', 6), now)).toBe(false)
    expect(hasRunningCheck(withCheck(undefined, 4), now)).toBe(true)
    expect(hasRunningCheck(withCheck('hawkim', 29), now)).toBe(true)
    expect(hasRunningCheck(withCheck('hawkim', 31), now)).toBe(false)
    expect(hasRunningCheck(withCheck('sample', 1, 'completed'), now)).toBe(false)
  })

  it('knows the Edge Function refusal codes', () => {
    for (const code of ['not-found', 'not-allowed', 'not-deletable', 'check-running', 'invalid-reason']) expect(isSopDeleteErrorCode(code)).toBe(true)
    expect(isSopDeleteErrorCode('failed')).toBe(false)
    expect(isSopDeleteErrorCode(undefined)).toBe(false)
  })
})
