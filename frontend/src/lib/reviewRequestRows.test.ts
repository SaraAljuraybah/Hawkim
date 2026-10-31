import { describe, expect, it } from 'vitest'
import type { InternalReviewerAssignment } from '../data/mock/types'
import { formatReviewDate } from './format'
import { requestDecisionDate, requestReviewDueDate, reviewNotes } from './reviewRequestRows'

const request = (extra: Partial<InternalReviewerAssignment>): InternalReviewerAssignment =>
  ({ id: 'request', userId: 'alpha', decision: 'pending', assignedAt: '2026-10-01T08:00:00Z', ...extra })

describe('review request rows', () => {
  it('uses the accept date, or the decline date, as the decision date', () => {
    expect(requestDecisionDate(request({}))).toBeUndefined()
    expect(requestDecisionDate(request({ decision: 'withdrawn', withdrawnAt: '2026-10-05T00:00:00Z' }))).toBeUndefined()
    expect(requestDecisionDate(request({ decision: 'completed', acceptedAt: '2026-10-02T08:00:00Z', decidedAt: '2026-10-04T08:00:00Z' }))).toBe('2026-10-02T08:00:00Z')
    expect(requestDecisionDate(request({ decision: 'declined', declineReason: 'On leave', decidedAt: '2026-10-03T08:00:00Z' }))).toBe('2026-10-03T08:00:00Z')
  })

  it('shows the review due date only once accepted', () => {
    expect(requestReviewDueDate(request({ reviewDueDate: '2026-10-09' }))).toBeUndefined()
    expect(requestReviewDueDate(request({ acceptedAt: '2026-10-02T08:00:00Z', reviewDueDate: '2026-10-09' }))).toBe('2026-10-09')
    expect(requestReviewDueDate(request({ acceptedAt: '2026-10-02T08:00:00Z' }))).toBeUndefined()
  })

  it('collects the comments and reasons, each with its date', () => {
    const comments = [{ id: 'comment', version: '1', authorId: 'alpha', role: 'reviewer', text: 'Revise section 2', createdAt: '2026-10-04T08:00:00Z' }] as never
    expect(reviewNotes({ comments }, request({}))).toEqual([])
    expect(reviewNotes({ comments }, request({ declineReason: 'On leave', decidedAt: '2026-10-03T08:00:00Z' }))).toEqual([{ kind: 'decline', text: 'On leave', date: '2026-10-03T08:00:00Z' }])
    expect(reviewNotes({ comments }, request({ commentId: 'comment', removalReason: 'Not needed', removedAt: '2026-10-05T08:00:00Z' }))).toEqual([
      { kind: 'comment', text: 'Revise section 2', date: '2026-10-04T08:00:00Z' },
      { kind: 'removal', text: 'Not needed', date: '2026-10-05T08:00:00Z' },
    ])
  })

  it('shows a late-evening UTC timestamp on its Riyadh date', () => {
    expect(formatReviewDate('2026-11-01T22:00:00Z')).toBe('Nov 2, 2026')
  })
})
