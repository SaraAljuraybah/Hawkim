import { describe, expect, it } from 'vitest'
import type { Sop, User, UserRequest } from '../data/mock/types'
import { visibleSops } from './visibleSops'

const user = (id: string, permissions: User['permissions'] = ['author']): User => ({ id, name: id, email: id + '@example.test', initials: 'TT', departmentId: 'home', permissions })
const sop = (id: string, authorId: string): Sop => ({
  id, code: 'SOP-001', title: id, departmentId: 'home', authorId, coAuthorIds: [], status: 'draft', version: '2', lastUpdated: '2026-10-29',
  fileName: 'private-v2.pdf', fileType: 'pdf', fileUrl: '/private-v2.pdf',
  versions: [{ version: '1', fileName: 'old.pdf', fileType: 'pdf', fileUrl: '/old.pdf', uploadedAt: '2026-10-20T08:00:00Z' }, { version: '2', fileName: 'private-v2.pdf', fileType: 'pdf', fileUrl: '/private-v2.pdf', uploadedAt: '2026-10-29T08:00:00Z' }],
  reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [],
})

describe('session-specific local SOP projection', () => {
  it('never exposes the previous user private SOP when the identity changes or signs out', () => {
    const workspace = [sop('a-private', 'a'), sop('b-private', 'b')]
    expect(visibleSops(workspace, user('a'), []).map((item) => item.id)).toEqual(['a-private'])
    expect(visibleSops(workspace, user('b'), []).map((item) => item.id)).toEqual(['b-private'])
    expect(visibleSops(workspace, null, [])).toEqual([])
    expect(visibleSops(workspace, { ...user('a'), deletedAt: '2026-10-29' }, [])).toEqual([])
    expect(workspace).toHaveLength(2)
  })

  it('retains shared author/co-author access without authorizing unrelated home-department drafts', () => {
    const workspace = [sop('own', 'a'), { ...sop('coauthored', 'b'), coAuthorIds: ['a'] }, sop('unrelated', 'b')]
    expect(visibleSops(workspace, user('a'), []).map((item) => item.id)).toEqual(['own', 'coauthored'])
  })

  it('requires each user own approved grant and published status for another department', () => {
    const workspace = ['one', 'two', 'three'].flatMap((id) => [{ ...sop(id, 'other'), departmentId: id, status: 'published' as const }, { ...sop(id + '-draft', 'other'), departmentId: id }])
    const requests: UserRequest[] = ['one', 'two', 'three'].map((id, index) => ({ id, requesterId: 'a', departmentId: id, title: 'Access', description: '', type: 'department-access', status: index === 2 ? 'pending' : 'approved', createdAt: '2026-10-29' }))
    expect(visibleSops(workspace, user('a'), requests).map((item) => item.id)).toEqual(['one', 'two'])
    expect(visibleSops(workspace, user('b'), requests)).toEqual([])
    requests[0].status = 'rejected'
    expect(visibleSops(workspace, user('a'), requests).map((item) => item.id)).toEqual(['two'])
  })

  it('projects a former reviewer to the assigned version instead of a new cached file', () => {
    const document: Sop = { ...sop('reviewed', 'author'), status: 'in-review', internalReviewRounds: [{ id: 'old', scope: 'internal', version: '1', requestedById: 'author', requestedAt: '2026-10-20T08:00:00Z', status: 'completed', assignedDueDays: null, assignments: [{ id: 'task', userId: 'reviewer', decision: 'completed', assignedAt: '2026-10-20T08:00:00Z', assignedDueDays: null }] }] }
    const visible = visibleSops([document], user('reviewer', ['reviewer']), [])[0]
    expect(visible.version).toBe('1')
    expect(visible.fileUrl).toBe('/old.pdf')
    expect(visible.versions.map((version) => version.version)).toEqual(['1'])
    expect(JSON.stringify(visible)).not.toContain('/private-v2.pdf')
    expect(visibleSops([document], user('reviewer', ['approver']), [])).toEqual([])
  })

  it('does not use an obsolete Approver permission when only Reviewer permission remains', () => {
    const document: Sop = { ...sop('approval', 'author'), approvers: [{ userId: 'controller', decision: 'pending' }] }
    expect(visibleSops([document], user('controller', ['reviewer']), [])).toEqual([])
    expect(visibleSops([document], user('controller', ['approver']), [])).toHaveLength(1)
  })

  it('keeps the existing authorized administration view', () => {
    const workspace = [sop('a-private', 'a'), sop('b-private', 'b')]
    expect(visibleSops(workspace, user('admin', ['admin']), [])).toEqual(workspace)
  })
})
