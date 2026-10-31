import { describe, expect, it } from 'vitest'
import type { ApproverAssignment, InternalReviewDecision, ReviewerAssignment, Sop } from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { reviewTasks, reviewerTaskSection, sortTodo } from './reviews'

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
    version: '1',
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
      timeline: [{ id: `${code}-1`, type: 'submitted', actorId: 'sara', version: '1', createdAt: sentAt }],
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


describe('sequential reviewer task deadlines', () => {
  it('keeps queued reviewers waiting and exposes each person?s own deadline', () => {
    const item = sop('QUEUE', 'in-review', [
      { userId: 'noura', decision: 'pending', dueDate: '2026-10-20', assignedDueDays: 2 },
      { userId: 'faisal', decision: 'pending', dueDate: '2026-10-25', assignedDueDays: 7 },
    ], [{ userId: 'huda', decision: 'pending' }])
    expect(group('noura', item)).toBe('reviewer todo review')
    expect(group('faisal', item)).toBe('reviewer waiting')
    expect(reviewTasks('faisal', [item])[0].dueAt).toBe(new Date('2026-10-25T23:59:59.999').toISOString())
    item.reviewers[0].decision = 'completed'
    expect(group('faisal', item)).toBe('reviewer todo review')
    expect(group('noura', item)).toBe('reviewer done')
  })
})

describe('reviewer-facing sections', () => {
  function internal(decision: InternalReviewDecision): Sop {
    return sop('INTERNAL', 'in-review', [], [], {
      internalReviewRounds: [{ id: 'round', scope: 'internal', version: '1', status: 'open', requestedById: 'sara', requestedAt: '2026-10-01T09:15:23Z', assignedDueDays: null,
        assignments: [{ id: 'request', userId: 'noura', decision, assignedAt: '2026-10-01T09:15:23Z', responseDueDate: '2026-10-03', reviewDurationDays: 5 }] }],
    })
  }

  it('separates pending acceptance from accepted active work without changing workflow groups', () => {
    const pending = reviewTasks('noura', [internal('pending')], Date.parse('2026-10-02T09:00:00Z'))[0]
    const accepted = reviewTasks('noura', [internal('accepted')])[0]
    expect(pending.group).toBe('todo')
    expect(accepted.group).toBe('todo')
    expect(reviewerTaskSection(pending)).toBe('incoming')
    expect(reviewerTaskSection(accepted)).toBe('active')
  })
  it('moves an expired pending request to history at its precise response timestamp without recording a decision', () => {
    const item = internal('pending')
    const request = item.internalReviewRounds![0].assignments[0]
    request.responseDueAt = '2026-10-03T20:59:59.999Z'
    request.deadlinePolicy = 'riyadh-working-days-v1'
    const before = structuredClone(item)
    const deadline = Date.parse(request.responseDueAt)
    const pending = reviewTasks('noura', [item], deadline - 1)[0]
    expect(pending.group).toBe('todo')
    expect(reviewerTaskSection(pending)).toBe('incoming')
    const expired = reviewTasks('noura', [item], deadline)[0]
    expect(expired.group).toBe('done')
    expect(reviewerTaskSection(expired)).toBe('completed')
    expect(expired.need).toBeUndefined()
    expect(expired.decision).toBe('pending')
    expect(expired.dueAt).toBe('2026-10-03T20:59:59.999Z')
    expect(expired.reviewer?.decision).toBe('pending')
    expect(item).toEqual(before)
  })

  it.each(['completed', 'returned', 'declined', 'withdrawn', 'removed'] as const)('keeps %s requests in history with their actual decision', (decision) => {
    const task = reviewTasks('noura', [internal(decision)])[0]
    expect(reviewerTaskSection(task)).toBe('completed')
    expect(task.decision).toBe(decision)
  })

  it('keeps legacy pending and queued reviewers under Active, preserving their waiting group and individual deadlines', () => {
    const item = sop('LEGACY', 'in-review', [
      { userId: 'other', decision: 'pending', dueDate: '2026-10-10' },
      { userId: 'noura', decision: 'pending', dueDate: '2026-10-25' },
    ], [])
    const task = reviewTasks('noura', [item])[0]
    expect(task.group).toBe('waiting')
    expect(reviewerTaskSection(task)).toBe('active')
    expect(task.reviewer?.userId).toBe('noura')
    expect(task.reviewer?.dueDate).toBe('2026-10-25')
  })

  it('keeps a returned legacy decision under Completed while preserving its waiting workflow group', () => {
    const task = reviewTasks('noura', [sop('LEGACY', 'returned', reviewer('returned'), [])])[0]
    expect(task.group).toBe('waiting')
    expect(reviewerTaskSection(task)).toBe('completed')
    expect(task.decision).toBe('returned')
  })

  it('shows one latest request per SOP, assigned only to the current person', () => {
    const item = internal('declined')
    item.internalReviewRounds![0].assignments.push({ id: 'new-request', userId: 'noura', decision: 'pending', assignedAt: '2026-10-02T13:05:02Z' })
    const tasks = reviewTasks('noura', [item])
    expect(tasks).toHaveLength(1)
    expect(tasks[0].reviewer).toMatchObject({ id: 'new-request', decision: 'pending' })
    expect(reviewTasks('unassigned', [item])).toEqual([])
  })

  it('does not reactivate an open historical request when its assigned version is projected for access', () => {
    const item = internal('pending')
    item.version = '2'
    item.versions = [{ version: '1', fileName: 'old.pdf', fileType: 'pdf', uploadedAt: '2026-10-01T09:00:00Z' }, { version: '2', fileName: 'new.pdf', fileType: 'pdf', uploadedAt: '2026-10-03T09:00:00Z' }]
    item.internalReviewRounds!.push({ ...item.internalReviewRounds![0], id: 'new-round', version: '2', assignments: [{ id: 'other-request', userId: 'other', decision: 'pending', assignedAt: '2026-10-03T09:15:23Z' }] })
    const task = reviewTasks('noura', [item])[0]
    expect(task.sop.version).toBe('1')
    expect(task.group).toBe('done')
    expect(task.need).toBeUndefined()
    expect(reviewerTaskSection(task)).toBe('completed')
  })
})
