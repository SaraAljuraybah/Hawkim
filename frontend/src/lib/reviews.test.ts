import { describe, expect, it } from 'vitest'
import type { ApproverAssignment, ReviewerAssignment, Sop } from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { reviewTasks, sortTodo } from './reviews'

/* Noura reviews; Huda approves. Each SOP is set up directly in the state being tested. */
function sop(
  code: string,
  status: SopStatus,
  reviewers: ReviewerAssignment[],
  approvers: ApproverAssignment[],
  extra: Partial<Sop> = {},
): Sop {
  return {
    id: code,
    code,
    title: code,
    departmentId: 'information-technology',
    version: '1.0',
    status,
    lastUpdated: '2026-10-01',
    authorId: 'sara',
    coAuthorIds: [],
    fileName: `${code}.pdf`,
    fileType: 'pdf',
    reviewers,
    approvers,
    versions: [],
    comments: [],
    timeline: [],
    complianceChecks: [],
    ...extra,
  }
}
const reviewer = (decision: ReviewerAssignment['decision']): ReviewerAssignment[] => [{ userId: 'noura', decision }]
const approver = (decision: ApproverAssignment['decision']): ApproverAssignment[] => [{ userId: 'huda', decision }]
const group = (userId: string, item: Sop) => {
  const task = reviewTasks(userId, [item])[0]
  return task ? `${task.role} ${task.group}${task.need ? ` ${task.need}` : ''}` : 'none'
}

describe('reviewer tasks', () => {
  it('is to do while In Review with their decision pending', () => {
    expect(group('noura', sop('A', 'in-review', reviewer('pending'), approver('pending')))).toBe('reviewer todo review')
  })

  it('is done once they decided, even while others still review', () => {
    expect(group('noura', sop('A', 'in-review', reviewer('completed'), approver('pending')))).toBe('reviewer done')
    expect(group('noura', sop('A', 'in-approval', reviewer('completed'), approver('pending')))).toBe('reviewer done')
    expect(group('noura', sop('A', 'approved', reviewer('completed'), approver('approved')))).toBe('reviewer done')
  })

  it('waits while the SOP is returned to the author, whoever returned it', () => {
    expect(group('noura', sop('A', 'returned', reviewer('returned'), approver('pending')))).toBe('reviewer waiting')
    expect(group('noura', sop('A', 'returned', reviewer('completed'), approver('returned')))).toBe('reviewer waiting')
  })

  it('is done when the SOP is published', () => {
    expect(group('noura', sop('A', 'published', reviewer('completed'), approver('approved')))).toBe('reviewer done')
  })
})

describe('approver tasks', () => {
  it('waits while the SOP is still In Review, or returned', () => {
    expect(group('huda', sop('A', 'in-review', reviewer('pending'), approver('pending')))).toBe('approver waiting')
    expect(group('huda', sop('A', 'returned', reviewer('returned'), approver('pending')))).toBe('approver waiting')
  })

  it('is to do while In Approval with their decision pending, then done once approved', () => {
    expect(group('huda', sop('A', 'in-approval', reviewer('completed'), approver('pending')))).toBe('approver todo approval')
    const twoApprovers: ApproverAssignment[] = [
      { userId: 'huda', decision: 'approved' },
      { userId: 'khalid', decision: 'pending' },
    ]
    expect(group('huda', sop('A', 'in-approval', reviewer('completed'), twoApprovers))).toBe('approver done')
  })

  it('is to do for every assigned approver once Approved (to publish), and done once published', () => {
    expect(group('huda', sop('A', 'approved', reviewer('completed'), approver('approved')))).toBe('approver todo publish')
    expect(group('huda', sop('A', 'published', reviewer('completed'), approver('approved')))).toBe('approver done')
  })

  it('lists nothing for SOPs the user isn’t assigned to', () => {
    expect(group('lama', sop('A', 'in-review', reviewer('pending'), approver('pending')))).toBe('none')
  })
})

describe('sorting To do', () => {
  const now = Date.parse('2026-10-10T12:00:00Z')
  const inReview = (code: string, reviewDueAt: string | undefined, sentAt: string) =>
    sop(code, 'in-review', reviewer('pending'), [], {
      reviewDueAt,
      timeline: [{ id: `${code}-1`, type: 'submitted', actorId: 'sara', version: '1.0', createdAt: sentAt }],
    })

  it('puts overdue first, then the nearest due date, then no due date by oldest sent', () => {
    const tasks = reviewTasks('noura', [
      inReview('NO-DUE-NEW', undefined, '2026-10-05T09:00:00Z'),
      inReview('DUE-LATER', '2026-10-20T09:00:00Z', '2026-10-01T09:00:00Z'),
      inReview('OVERDUE', '2026-10-08T09:00:00Z', '2026-10-02T09:00:00Z'),
      inReview('NO-DUE-OLD', undefined, '2026-09-20T09:00:00Z'),
      inReview('DUE-SOON', '2026-10-12T09:00:00Z', '2026-10-03T09:00:00Z'),
    ])
    expect(sortTodo(tasks, now).map((task) => task.sop.code)).toEqual([
      'OVERDUE',
      'DUE-SOON',
      'DUE-LATER',
      'NO-DUE-OLD',
      'NO-DUE-NEW',
    ])
  })
})
