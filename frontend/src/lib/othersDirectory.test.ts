import { describe, expect, it } from 'vitest'
import { directorySopsFor } from './sopAccess'
import { filterDirectorySops } from './sopDirectory'
import type { Sop, User } from '../data/mock/types'
const user = { id: 'author', departmentId: 'new-home' } as User
const make = (values: Partial<Sop>): Sop => ({ id: 'sop', code: 'SOP-001', title: 'Moved SOP', departmentId: 'removed', directoryGroup: 'others', status: 'published', authorId: 'author', coAuthorIds: [], fileType: 'pdf', lastUpdated: '2026-11-01', ...values }) as Sop
describe('real Others directory grouping', () => {
  it('includes an authorized moved SOP without requiring the removed department in the switcher', () => {
    const sops = [make({})]
    expect(filterDirectorySops(directorySopsFor(sops,user,[]),user.departmentId,'','all','newest','others')).toEqual(sops)
    expect(filterDirectorySops(sops,'removed')).toEqual([])
  })
  it('preserves author and co-author access to moved drafts while keeping unrelated users out', () => {
    const draft = make({ status: 'draft' })
    expect(directorySopsFor([draft],user,[])).toEqual([draft])
    expect(directorySopsFor([draft],{ ...user,id:'unrelated' },[])).toEqual([])
    expect(directorySopsFor([make({ status:'draft',coAuthorIds:['co'] })],{ ...user,id:'co' },[])).toHaveLength(1)
  })
  it('does not grant all users access just because an SOP moved to Others', () => {
    expect(directorySopsFor([make({})],{ ...user,id:'unrelated' },[])).toEqual([])
    expect(directorySopsFor([make({})],{ ...user,deletedAt:'2026-11-01' },[])).toEqual([])
  })
})
