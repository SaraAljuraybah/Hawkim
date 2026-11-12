import { describe, expect, it } from 'vitest'
import type { InternalReviewerAssignment } from '../data/mock/types'
import { formatReviewDate } from './format'
import { requestResponseDate, requestReviewDueDate, timelineNote } from './reviewRequestRows'

const request = (extra: Partial<InternalReviewerAssignment>): InternalReviewerAssignment =>
  ({ id: 'request', userId: 'alpha', decision: 'pending', assignedAt: '2026-10-01T08:00:00Z', ...extra })

describe('review request rows', () => {
  it('uses the accept date, or the decline date, as the decision date', () => {
    expect(requestResponseDate(request({}))).toBeUndefined()
    expect(requestResponseDate(request({ decision: 'withdrawn', withdrawnAt: '2026-10-05T00:00:00Z' }))).toBeUndefined()
    expect(requestResponseDate(request({ decision: 'completed', acceptedAt: '2026-10-02T08:00:00Z', decidedAt: '2026-10-04T08:00:00Z' }))).toBe('2026-10-02T08:00:00Z')
    expect(requestResponseDate(request({ decision: 'declined', declineReason: 'On leave', decidedAt: '2026-10-03T08:00:00Z' }))).toBe('2026-10-03T08:00:00Z')
  })

  it('shows the review due date only once accepted', () => {
    expect(requestReviewDueDate(request({ reviewDueDate: '2026-10-09' }))).toBeUndefined()
    expect(requestReviewDueDate(request({ acceptedAt: '2026-10-02T08:00:00Z', reviewDueDate: '2026-10-09' }))).toBe('2026-10-09')
    expect(requestReviewDueDate(request({ acceptedAt: '2026-10-02T08:00:00Z' }))).toBeUndefined()
  })

  it('finds the note each Timeline action previews: reasons, and review comments with their request', () => {
    const comments = [{ id: 'comment', version: '1', authorId: 'alpha', role: 'reviewer', text: 'Revise section 2', createdAt: '2026-10-04T08:00:00Z' }] as never
    const returned = request({ decision: 'returned', commentId: 'comment' })
    const sop = { comments, internalReviewRounds: [{ assignments: [returned] }] } as never
    const event = (type: string, extra: object = {}) => ({ id: type, type, actorId: 'alpha', version: '1', createdAt: '2026-10-04T08:00:00Z', ...extra }) as never
    expect(timelineNote(sop, event('review-changes-requested', { commentId: 'comment', reviewAssignmentId: 'request' }))).toEqual({
      type: 'review-changes-requested', reviewerId: 'alpha', note: { kind: 'comment', text: 'Revise section 2', date: '2026-10-04T08:00:00Z' }, request: returned,
    })
    expect(timelineNote(sop, event('review-completed', { commentId: 'comment' }))).toMatchObject({ type: 'review-completed', note: { kind: 'comment' } })
    // Completed without comments: nothing to preview.
    expect(timelineNote(sop, event('review-completed', { createdAt: '2026-10-09T08:00:00Z' }))).toBeUndefined()
    expect(timelineNote(sop, event('review-declined', { note: 'On leave' }))).toMatchObject({ reviewerId: 'alpha', note: { kind: 'decline', text: 'On leave' } })
    expect(timelineNote(sop, event('reviewer-removed', { note: 'Not needed', actorId: 'author', recipientIds: ['alpha'] }))).toMatchObject({ reviewerId: 'alpha', note: { kind: 'removal' } })
    expect(timelineNote(sop, event('submitted', { note: 'Please review' }))).toBeUndefined()
  })

  it('shows a late-evening UTC timestamp on its Riyadh date', () => {
    expect(formatReviewDate('2026-11-01T22:00:00Z')).toBe('Nov 2, 2026')
  })
})
