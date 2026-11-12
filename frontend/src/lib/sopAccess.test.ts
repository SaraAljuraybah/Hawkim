import { describe, expect, it } from 'vitest'
import type { DepartmentId, InternalReviewRound, Sop, UserRequest } from '../data/mock/types'
import type { Status } from '../types/status'
import { directoryAccess, directorySopsFor, getSopAccess, workedOn } from './sopAccess'

// Sara works in IT. The SOPs below belong to other departments unless stated.
const sara = { id: 'sara', departmentId: 'information-technology' as DepartmentId }

/** One of Sara's requests to the admin team. */
function request(type: UserRequest['type'], departmentId: DepartmentId | undefined, status: Status): UserRequest {
  return {
    id: `req-${type}-${departmentId}-${status}`,
    title: 'Request',
    type,
    departmentId,
    description: '',
    createdAt: '2026-01-01',
    status,
    requesterId: 'sara',
  }
}

describe('getSopAccess', () => {
  it('grants access to SOPs of the home department, without any request', () => {
    expect(getSopAccess({ status: 'published', departmentId: 'information-technology' }, sara, [])).toBe('granted')
  })

  it('grants access to a published directory through an approved access request', () => {
    const requests = [request('department-access', 'pharmacovigilance', 'approved')]
    expect(getSopAccess({ status: 'published', departmentId: 'pharmacovigilance' }, sara, requests)).toBe('granted')
  })

  it('shows "requested" while an access request for that department is pending', () => {
    const requests = [request('department-access', 'pharmacovigilance', 'pending')]
    expect(getSopAccess({ status: 'published', departmentId: 'pharmacovigilance' }, sara, requests)).toBe('requested')
  })

  it('is locked without a request, or when the request was rejected or cancelled', () => {
    expect(getSopAccess({ status: 'published', departmentId: 'pharmacovigilance' }, sara, [])).toBe('locked')
    expect(
      getSopAccess({ status: 'published', departmentId: 'pharmacovigilance' }, sara, [
        request('department-access', 'pharmacovigilance', 'rejected'),
        request('department-access', 'pharmacovigilance', 'cancelled'),
      ]),
    ).toBe('locked')
  })

  it('only counts department-access requests for the SOP’s own department', () => {
    const requests = [
      request('department-access', 'quality-assurance', 'approved'),
      request('permission-change', undefined, 'approved'),
    ]
    expect(getSopAccess({ status: 'published', departmentId: 'pharmacovigilance' }, sara, requests)).toBe('locked')
  })

  it('prefers "granted" when an approved and a pending request exist for the same department', () => {
    const requests = [
      request('department-access', 'pharmacovigilance', 'pending'),
      request('department-access', 'pharmacovigilance', 'approved'),
    ]
    expect(getSopAccess({ status: 'published', departmentId: 'pharmacovigilance' }, sara, requests)).toBe('granted')
  })
})

describe('directory grants are requester-specific and published-only', () => {
  it.each(['draft', 'in-review', 'returned', 'in-approval', 'approved'] as const)('never grants directory access to %s SOPs', (status) => {
    const approved = [request('department-access', 'pharmacovigilance', 'approved')]
    expect(getSopAccess({ status, departmentId: 'pharmacovigilance' }, sara, approved)).toBe('locked')
    expect(getSopAccess({ status, departmentId: sara.departmentId }, sara, approved)).toBe('locked')
  })
  it('does not use another requester approval or pending request', () => {
    for (const status of ['approved', 'pending'] as const) {
      const other = { ...request('department-access', 'pharmacovigilance', status), requesterId: 'someone-else' }
      expect(getSopAccess({ status: 'published', departmentId: 'pharmacovigilance' }, sara, [other])).toBe('locked')
    }
  })
  it('denies a deleted account', () => {
    expect(getSopAccess({ status: 'published', departmentId: sara.departmentId }, { ...sara, deletedAt: '2026-10-23' }, [])).toBe('locked')
  })
})

describe('getSopAccess for a System Admin', () => {
  const admin = { id: 'nouf', departmentId: 'information-technology' as DepartmentId, permissions: ['admin' as const] }

  it('grants every department\'s published SOPs, without a request', () => {
    expect(getSopAccess({ status: 'published', departmentId: 'quality-assurance' }, admin, [])).toBe('granted')
  })

  it('still locks SOPs in Others, unpublished SOPs and a deleted account', () => {
    expect(getSopAccess({ status: 'published', departmentId: 'quality-assurance', directoryGroup: 'others', authorId: 'sara' }, admin, [])).toBe('locked')
    expect(getSopAccess({ status: 'in-review', departmentId: 'quality-assurance' }, admin, [])).toBe('locked')
    expect(getSopAccess({ status: 'published', departmentId: 'quality-assurance' }, { ...admin, deletedAt: '2026-10-23' }, [])).toBe('locked')
  })

  it('leaves other roles as they were', () => {
    expect(getSopAccess({ status: 'published', departmentId: 'quality-assurance' }, { ...sara, permissions: ['author', 'reviewer', 'approver'] }, [])).toBe('locked')
  })
})

describe('the SOP Directory: their department\'s published SOPs, plus those the user worked on (everyone but the System Admin)', () => {
  const me = { id: 'sara', departmentId: 'information-technology' as DepartmentId, permissions: ['author' as const, 'reviewer' as const] }
  const base = { id: 'x', departmentId: 'quality-assurance', status: 'published', authorId: 'someone', coAuthorIds: [], reviewers: [], approvers: [] } as unknown as Sop
  const round = (decision: string): InternalReviewRound[] => [{ assignments: [{ userId: 'sara', decision }] } as unknown as InternalReviewRound]

  it('counts the main author, a co-author, a reviewer who completed or returned a review, and an approver who approved', () => {
    expect(workedOn({ ...base, authorId: 'sara' }, 'sara')).toBe(true)
    expect(workedOn({ ...base, coAuthorIds: ['sara'] }, 'sara')).toBe(true)
    expect(workedOn({ ...base, internalReviewRounds: round('completed') }, 'sara')).toBe(true)
    expect(workedOn({ ...base, internalReviewRounds: round('returned') }, 'sara')).toBe(true)
    expect(workedOn({ ...base, reviewers: [{ userId: 'sara', decision: 'completed' }] }, 'sara')).toBe(true)
    expect(workedOn({ ...base, approvers: [{ userId: 'sara', decision: 'approved' }] } as Sop, 'sara')).toBe(true)
  })

  it('doesn\'t count a review they didn\'t finish, a pending approval, or someone else\'s SOP', () => {
    for (const decision of ['pending', 'accepted', 'declined', 'withdrawn', 'expired', 'removed']) {
      expect(workedOn({ ...base, internalReviewRounds: round(decision) }, 'sara'), decision).toBe(false)
    }
    expect(workedOn({ ...base, approvers: [{ userId: 'sara', decision: 'pending' }] } as Sop, 'sara')).toBe(false)
    expect(workedOn(base, 'sara')).toBe(false)
  })

  it('never lists an SOP they authored that isn\'t published: draft, in review, in approval, approved or returned', () => {
    const statuses = ['draft', 'in-review', 'in-approval', 'approved', 'returned'] as const
    const mine = statuses.map((status) => ({ ...base, id: status, status, authorId: 'sara' }))
    expect(directorySopsFor(mine, me)).toEqual([])
    for (const sop of mine) expect(directoryAccess(sop, me), sop.status).toBe('locked')
    // The same SOP once published is listed.
    expect(directorySopsFor([...mine, { ...base, id: 'published', authorId: 'sara' }], me).map((sop) => sop.id)).toEqual(['published'])
  })

  it('lists every published SOP of their department, and theirs in any department and in Others, once each; nothing for a deleted account', () => {
    const items = [
      { ...base, id: 'other-department', authorId: 'sara' },
      { ...base, id: 'others', authorId: 'sara', directoryGroup: 'others' as const },
      { ...base, id: 'colleague', departmentId: 'information-technology' },
      // Both their department's and one they reviewed: listed once.
      { ...base, id: 'both', departmentId: 'information-technology', internalReviewRounds: round('completed') },
      { ...base, id: 'elsewhere' },
      { ...base, id: 'colleague-draft', departmentId: 'information-technology', status: 'draft' as const },
    ]
    expect(directorySopsFor(items, me).map((sop) => sop.id)).toEqual(['other-department', 'others', 'colleague', 'both'])
    expect(directoryAccess(items[2], me)).toBe('granted')
    expect(directoryAccess(items[4], me)).toBe('locked')
    expect(directoryAccess(items[5], me)).toBe('locked')
    expect(directorySopsFor(items, { ...me, deletedAt: '2026-10-23' })).toEqual([])
  })

  it('never opens an Others SOP by department: only to those who worked on it', () => {
    const others = { ...base, id: 'others', departmentId: 'information-technology', directoryGroup: 'others' as const }
    expect(directoryAccess(others, me)).toBe('locked')
    expect(directoryAccess({ ...others, coAuthorIds: ['sara'] }, me)).toBe('granted')
  })

  it('leaves the System Admin with every department\'s published SOPs, not Others', () => {
    const admin = { id: 'nouf', departmentId: '', permissions: ['admin' as const] }
    const items = [{ ...base, id: 'any' }, { ...base, id: 'draft', status: 'draft' as const }, { ...base, id: 'others', directoryGroup: 'others' as const }]
    expect(directorySopsFor(items, admin).map((sop) => sop.id)).toEqual(['any'])
  })
})
