import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { InternalReviewerAssignment, Sop } from '../../data/mock/types'
import { projectReviewers } from '../../lib/internalReviewStatus'
import { UsersContext, type UsersStore } from '../../state/usersContext'
import { ReviewerDeadline } from './ReviewerDeadline'
import { ResubmitDialog } from './ResubmitDialog'
import { PeopleList } from './PeopleList'
import { StatusTracker } from './StatusTracker'
import { InternalReviewSummary } from './InternalReviewSummary'
import { formatReviewDuration } from '../../lib/reviewDuration'
import type { ReactNode } from 'react'

const users: UsersStore = {
  status: 'ready', users: [], activeUsers: [], getUser: () => undefined, nameOf: (id) => id ?? '',
  addUser: () => { throw new Error('unused') }, updatePermissions: () => {}, deleteUser: () => {},
}
const render = (node: ReactNode) => renderToStaticMarkup(<UsersContext value={users}>{node}</UsersContext>)
function sop(): Sop {
  return {
    id: 'test', code: 'SOP-001', title: 'Test', departmentId: 'information-technology', version: '1',
    status: 'in-review', lastUpdated: '2026-10-18', authorId: 'Author', coAuthorIds: [],
    fileName: 'test.pdf', fileType: 'pdf', versions: [], timeline: [], comments: [], complianceChecks: [],
    reviewers: [
      { userId: 'First reviewer', decision: 'pending', dueDate: '2026-10-20', assignedDueDays: 2 },
      { userId: 'Next reviewer', decision: 'pending', dueDate: '2026-10-25', assignedDueDays: 7 },
      { userId: 'No deadline reviewer', decision: 'pending', assignedDueDays: null },
    ],
    approvers: [{ userId: 'Approval person', decision: 'pending' }, { userId: 'Second approver', decision: 'pending' }],
    approvalDueDays: 3,
  }
}
afterEach(() => vi.useRealTimers())

describe('reviewer deadline displays', () => {
  it('separates original time given, remaining time, and waiting status', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 19, 12) })
    const item = sop()
    const active = render(<ReviewerDeadline sop={item} reviewer={item.reviewers[0]} content={sopWorkflowEn.reviewerDeadline} showQueue />)
    expect(active).toContain('Time given: 2 days')
    expect(active).toContain('Time remaining: 1 day 11 hours')
    expect(active).toContain('Current Reviewer')
    const waiting = render(<ReviewerDeadline sop={item} reviewer={item.reviewers[1]} content={sopWorkflowEn.reviewerDeadline} showQueue />)
    expect(waiting).toContain('Time given: 7 days')
    expect(waiting).toContain('Waiting in Queue')
    expect(waiting).not.toContain('Time remaining')
    const blank = render(<ReviewerDeadline sop={item} reviewer={item.reviewers[2]} content={sopWorkflowEn.reviewerDeadline} />)
    expect(blank).toContain('No deadline assigned')
    expect(blank).not.toContain('<time')
  })
  it('asks for a due date for Reviewer 1 and comments on resubmission, like Submit, without a reviewer summary', () => {
    const html = render(<ResubmitDialog sop={sop()} content={sopWorkflowEn.dialogs} onSubmit={() => {}} onClose={() => {}} />)
    for (const text of ['Resubmit for Review', 'Review Due Date (Optional)', sopWorkflowEn.dialogs.submit.reviewDate.help, 'Comments (Optional)', 'Add a comment for the reviewers', 'type="date"', 'maxLength="500"']) expect(html).toContain(text)
    for (const text of ['First reviewer', 'Next reviewer', 'No deadline reviewer', 'Time given', 'No due date', 'Approval person', 'Approvers']) expect(html).not.toContain(text)
  })
  it('shows queue positions and individual deadlines in PeopleList', () => {
    const html = render(<PeopleList sop={sop()} content={sopWorkflowEn.people} userId="Author" canManageCoAuthors={false} onAddCoAuthor={() => {}} onRemoveCoAuthor={() => {}} />)
    expect(html).toContain('Current Reviewer')
    expect(html).toContain('Waiting in Queue')
    expect(html).toContain('Time given: 2 days')
    expect(html).toContain('Time given: 7 days')
    expect(html).toContain('No deadline assigned')
  })
  it('keeps all pending approvers in Current Assignees and updates after a decision', () => {
    const item = { ...sop(), status: 'in-approval' as const }
    const html = render(<StatusTracker sop={item} content={sopWorkflowEn.tracker} />)
    expect(html).toContain('Current Assignees')
    expect(html).toContain('Approval person, Second approver')
    item.approvers[0].decision = 'approved'
    const next = render(<StatusTracker sop={item} content={sopWorkflowEn.tracker} />)
    expect(next).toContain('Current Assignee')
    expect(next).toContain('Second approver')
    expect(next).not.toContain('Approval person')
  })
})


describe('parallel reviewer deadline displays', () => {
  /** An open internal round with one request per reviewer, each with its own deadlines. */
  function internal(assignments: InternalReviewerAssignment[]): Sop {
    const item = sop()
    item.internalReviewRounds = [{ id: 'parallel', scope: 'internal', version: item.version, status: 'open', requestedById: 'Author', requestedAt: '2026-10-18T09:00:00Z', assignedDueDays: null, assignments }]
    item.reviewers = projectReviewers(item.internalReviewRounds[0])
    return item
  }
  const request = (userId: string, extra: Partial<InternalReviewerAssignment> = {}): InternalReviewerAssignment =>
    ({ id: 'task-' + userId, userId, decision: 'pending', assignedAt: '2026-10-18T09:00:00Z', assignedDueDays: null, ...extra })

  it('shows the response due date and the review duration, starting when accepted, before acceptance', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 19, 12) })
    const item = internal([request('First reviewer', { responseDueDate: '2026-10-21', reviewDurationDays: 5 }), request('Next reviewer', { reviewDurationDays: 1 }), request('No deadline reviewer')])
    const [first, next, none] = item.internalReviewRounds![0].assignments
    const html = render(<ReviewerDeadline sop={item} reviewer={first} content={sopWorkflowEn.reviewerDeadline} showQueue />)
    expect(html).toContain('Review Pending')
    expect(html).toContain('Response due ')
    expect(html).toContain(new Date(2026, 9, 21, 23, 59, 59, 999).toISOString())
    expect(html).toContain('Review duration: 5 days, starts when accepted')
    expect(html).toContain('If there is no response by then, the request is withdrawn.')
    expect(html).not.toContain('Time remaining')
    expect(render(<ReviewerDeadline sop={item} reviewer={next} content={sopWorkflowEn.reviewerDeadline} />)).toContain('Review duration: 1 day, starts when accepted')
    const blank = render(<ReviewerDeadline sop={item} reviewer={none} content={sopWorkflowEn.reviewerDeadline} />)
    expect(blank).toContain('No response deadline')
    expect(blank).toContain('No review deadline')
    // The projected Sop.reviewers entry shows the same request.
    expect(render(<ReviewerDeadline sop={item} reviewer={item.reviewers[0]} content={sopWorkflowEn.reviewerDeadline} />)).toContain('Review duration: 5 days, starts when accepted')
    expect(render(<StatusTracker sop={item} content={sopWorkflowEn.tracker} />)).toContain('First reviewer, Next reviewer, No deadline reviewer')
  })
  it('shows the review due date and the time remaining after acceptance, then Review overdue at the exact end of the last day', () => {
    const deadline = new Date(2026, 9, 24, 23, 59, 59, 999).getTime()
    vi.useFakeTimers({ now: new Date(2026, 9, 24, 12, 30, 15, 125) })
    const item = internal([request('First reviewer', { decision: 'accepted', acceptedAt: new Date(2026, 9, 19, 15).toISOString(), reviewDurationDays: 5, reviewDueDate: '2026-10-24' })])
    const accepted = item.internalReviewRounds![0].assignments[0]
    const html = render(<ReviewerDeadline sop={item} reviewer={accepted} content={sopWorkflowEn.reviewerDeadline} />)
    expect(html).toContain('Review due ')
    expect(html).toContain(new Date(deadline).toISOString())
    expect(html).toContain('Time remaining: 11 hours 29 minutes')
    expect(html).not.toContain('starts when accepted')
    vi.setSystemTime(deadline - 1)
    expect(render(<ReviewerDeadline sop={item} reviewer={accepted} content={sopWorkflowEn.reviewerDeadline} />)).toContain('Time remaining: less than 1 second')
    vi.setSystemTime(deadline)
    const overdue = render(<ReviewerDeadline sop={item} reviewer={accepted} content={sopWorkflowEn.reviewerDeadline} />)
    expect(overdue).toContain('Review overdue')
    expect(overdue).not.toContain('Time remaining')
  })
  it('shows no countdown once the request is decided, declined, withdrawn or removed', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 21, 12) })
    for (const decision of ['completed', 'returned', 'declined', 'withdrawn', 'removed'] as const) {
      const item = internal([request('First reviewer', { decision, acceptedAt: new Date(2026, 9, 19, 15).toISOString(), reviewDurationDays: 1, reviewDueDate: '2026-10-20' })])
      const html = render(<ReviewerDeadline sop={item} reviewer={item.internalReviewRounds![0].assignments[0]} content={sopWorkflowEn.reviewerDeadline} />)
      expect(html).not.toContain('Time remaining')
      expect(html).not.toContain('Review overdue')
      expect(html).not.toContain('Review Pending')
    }
  })
  it('retains historical requests without active countdowns', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 1, 12) })
    const item = internal([])
    const old = request('First reviewer', { decision: 'completed', acceptedAt: new Date(2026, 9, 19, 15).toISOString(), reviewDurationDays: 2, reviewDueDate: '2026-10-21' })
    item.internalReviewRounds = [
      { id: 'old-round', scope: 'internal', version: '1', status: 'completed', requestedById: 'Author', requestedAt: '2026-10-18T09:00:00Z', assignedDueDays: null, assignments: [old] },
      { id: 'new-round', scope: 'internal', version: '2', status: 'open', requestedById: 'Author', requestedAt: new Date().toISOString(), assignedDueDays: null, assignments: [] },
    ]
    item.version = '2'
    const html = render(<ReviewerDeadline sop={item} reviewer={old} content={sopWorkflowEn.reviewerDeadline} />)
    expect(html).toContain(new Date(2026, 9, 21, 23, 59, 59, 999).toISOString())
    expect(html).not.toContain('Time remaining')
    expect(html).not.toContain('Review overdue')
  })
  it('keeps the round summary free of a shared deadline', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 19, 12) })
    const summary = render(<InternalReviewSummary sop={internal([request('First reviewer', { responseDueDate: '2026-10-21' })])} />)
    expect(summary).toContain('Reviews in Progress')
    expect(summary).not.toContain('Time given')
    expect(summary).not.toContain('Due ')
  })
  it('formats timestamp durations without rounding partial units up', () => {
    expect(formatReviewDuration(24 * 60 * 60 * 1_000 - 1)).toBe('23 hours 59 minutes')
    expect(formatReviewDuration(45_999)).toBe('45 seconds')
    expect(formatReviewDuration(999)).toBe('less than 1 second')
    expect(formatReviewDuration(45 * 24 * 60 * 60 * 1_000)).toBe('45 days')
  })
})
