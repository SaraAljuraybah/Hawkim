import { describe, expect, it } from 'vitest'
import type { InternalReviewRound, Sop } from '../data/mock/types'
import { projectReviewers } from './internalReviewStatus'
import { previousReport } from './compliance'
import { reviewSopForUser } from './reviewAccess'

function fixture(): Sop {
  const round = (version: string, userId: string): InternalReviewRound => ({ id: 'round-' + version, scope: 'internal', version, status: version === '1' ? 'completed' : 'open', requestedById: 'author', requestedAt: '2026-10-23T09:00:00Z', assignedDueDays: null,
    assignments: [{ id: 'task-' + version, userId, decision: version === '1' ? 'removed' : 'pending', assignedAt: '2026-10-23T09:00:00Z', assignedDueDays: null, ...(version === '1' ? { removalReason: 'No longer needed' } : {}) }] })
  const rounds = [round('1', 'a'), round('2', 'b')]
  return { id: 'test', code: 'TEST', title: 'Test', departmentId: 'home', authorId: 'author', coAuthorIds: [], version: '2', status: 'in-review', lastUpdated: '2026-10-23', fileName: 'private-v2.pdf', fileType: 'pdf', fileUrl: '/private-v2.pdf', reviewers: projectReviewers(rounds[1]), approvers: [], internalReviewRounds: rounds,
    versions: ['1', '2'].map((version) => ({ version, fileName: 'private-v' + version + '.pdf', fileType: 'pdf', fileUrl: '/private-v' + version + '.pdf', uploadedAt: '2026-10-23T09:00:00Z' })),
    complianceChecks: ['1', '2'].map((version) => ({ id: 'check-' + version, sopId: 'test', version, status: 'completed', startedAt: '2026-10-23T09:00:00Z', guideline: { name: 'GVP', version: '4.0' }, findings: [] })),
    comments: ['1', '2'].map((version) => ({ id: 'comment-' + version, version, authorUserId: 'a', role: 'reviewer', text: 'Feedback v' + version, createdAt: '2026-10-23T09:00:00Z' })),
    timeline: ['1', '2'].map((version) => ({ id: 'event-' + version, version, type: 'review-cancelled', actorId: 'author', createdAt: '2026-10-23T09:00:00Z' })),
  }
}

describe('review document access by assigned version', () => {
  it('retains removed history without exposing a later unassigned document or report', () => {
    const source = fixture()
    const before = JSON.stringify(source)
    const access = reviewSopForUser(source, 'a')!
    expect(access.historical).toBe(true)
    expect(access.sop).toMatchObject({ version: '1', fileName: 'private-v1.pdf', fileUrl: '/private-v1.pdf', status: 'in-review' })
    for (const entries of [access.sop.versions, access.sop.complianceChecks, access.sop.comments, access.sop.timeline, access.sop.internalReviewRounds!]) expect(entries.map((entry) => entry.version)).toEqual(['1'])
    expect(access.sop.reviewers[0].decision).toBe('cancelled')
    expect(JSON.stringify(access)).not.toContain('private-v2')
    expect(JSON.stringify(source)).toBe(before)
  })
  it('allows current work but omits reports of versions the reviewer never received', () => {
    const access = reviewSopForUser(fixture(), 'b')!
    expect(access.historical).toBe(false)
    expect(access.sop.fileUrl).toBe('/private-v2.pdf')
    expect(access.sop.complianceChecks.map((check) => check.version)).toEqual(['2'])
    expect(previousReport(access.sop, access.sop.complianceChecks[0])).toBeUndefined()
  })
  it('does not reintroduce a deleted historical version or grant access to an outsider', () => {
    const sop = fixture()
    sop.versions[0].deletedAt = '2026-10-23T10:00:00Z'
    expect(reviewSopForUser(sop, 'a')).toBeUndefined()
    expect(reviewSopForUser(sop, 'outsider')).toBeUndefined()
  })
  it('keeps repeated assignment access to both versions', () => {
    const sop = fixture()
    sop.internalReviewRounds![1].assignments[0].userId = 'a'
    const access = reviewSopForUser(sop, 'a')!
    expect(access.historical).toBe(false)
    expect(access.sop.versions.map((version) => version.version)).toEqual(['1', '2'])
  })
  it('preserves legacy and assigned-approver read access', () => {
    const legacy = { ...fixture(), internalReviewRounds: undefined }
    expect(reviewSopForUser(legacy, 'b')!.sop).toBe(legacy)
    const sop = fixture()
    sop.approvers = [{ userId: 'q', decision: 'pending' }]
    expect(reviewSopForUser(sop, 'q')!.sop).toBe(sop)
    expect(reviewSopForUser(sop, 'author')).toBeUndefined()
  })
})
