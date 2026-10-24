import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { Sop } from '../../data/mock/types'
import { UsersContext, type UsersStore } from '../../state/usersContext'
import { ReviewerDeadline } from './ReviewerDeadline'
import { ResubmitDialog } from './ResubmitDialog'
import { PeopleList } from './PeopleList'
import { StatusTracker } from './StatusTracker'
import { InternalReviewSummary } from './InternalReviewSummary'
import { formatReviewDuration } from '../../lib/reviewDuration'
import type { ReactNode } from 'react'

const users: UsersStore = {
  users: [], activeUsers: [], getUser: () => undefined, nameOf: (id) => id ?? '',
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
    expect(active).toContain('Current reviewer')
    const waiting = render(<ReviewerDeadline sop={item} reviewer={item.reviewers[1]} content={sopWorkflowEn.reviewerDeadline} showQueue />)
    expect(waiting).toContain('Time given: 7 days')
    expect(waiting).toContain('Waiting in queue')
    expect(waiting).not.toContain('Time remaining')
    const blank = render(<ReviewerDeadline sop={item} reviewer={item.reviewers[2]} content={sopWorkflowEn.reviewerDeadline} />)
    expect(blank).toContain('No deadline assigned')
    expect(blank).not.toContain('<time')
  })
  it('asks for a due date for Reviewer 1 and comments on resubmission, like Submit, without a reviewer summary', () => {
    const html = render(<ResubmitDialog sop={sop()} content={sopWorkflowEn.dialogs} onSubmit={() => {}} onClose={() => {}} />)
    for (const text of ['Resubmit for review', 'Review due date (optional)', sopWorkflowEn.dialogs.submit.reviewDate.help, 'Comments (optional)', 'Add a comment for the reviewers', 'type="date"', 'maxLength="500"']) expect(html).toContain(text)
    for (const text of ['First reviewer', 'Next reviewer', 'No deadline reviewer', 'Time given', 'No due date', 'Approval person', 'Approvers']) expect(html).not.toContain(text)
  })
  it('shows queue positions and individual deadlines in PeopleList', () => {
    const html = render(<PeopleList sop={sop()} content={sopWorkflowEn.people} userId="Author" canManageCoAuthors={false} onAddCoAuthor={() => {}} onRemoveCoAuthor={() => {}} />)
    expect(html).toContain('Current reviewer')
    expect(html).toContain('Waiting in queue')
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
  it('shows every pending reviewer as active with their own remaining time', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 19, 12) })
    const item = sop()
    item.internalReviewRounds = [{ id: 'parallel', scope: 'internal', version: item.version, status: 'open', requestedById: 'Author', requestedAt: '2026-10-18T09:00:00Z', dueDate: '2026-10-30', assignedDueDays: 12, assignments: item.reviewers.map((person, index) => ({ ...person, id: 'task-' + index, assignedAt: '2026-10-18T09:00:00Z' })) }]
    for (const reviewer of item.internalReviewRounds[0].assignments.slice(0, 2)) {
      const html = render(<ReviewerDeadline sop={item} reviewer={reviewer} content={sopWorkflowEn.reviewerDeadline} showQueue />)
      expect(html).toContain('Review pending')
      expect(html).toContain('Time remaining')
      expect(html).not.toContain('Waiting in queue')
    }
    const html = render(<StatusTracker sop={item} content={sopWorkflowEn.tracker} />)
    expect(html).toContain('First reviewer, Next reviewer, No deadline reviewer')
    expect(html).toContain('Review due date')
  })
  it('uses the individual deadline for overdue and stops displaying remaining time after cancellation', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 21, 12) })
    const item = sop()
    item.internalReviewRounds = [{ id: 'parallel', scope: 'internal', version: item.version, status: 'open', requestedById: 'Author', requestedAt: '2026-10-18T09:00:00Z', dueDate: '2026-10-30', assignedDueDays: 12, assignments: item.reviewers.map((person, index) => ({ ...person, id: 'task-' + index, assignedAt: '2026-10-18T09:00:00Z' })) }]
    const first = item.internalReviewRounds[0].assignments[0]
    expect(render(<ReviewerDeadline sop={item} reviewer={first} content={sopWorkflowEn.reviewerDeadline} />)).toContain('Overdue')
    first.decision = 'cancelled'
    const cancelled = render(<ReviewerDeadline sop={item} reviewer={first} content={sopWorkflowEn.reviewerDeadline} />)
    expect(cancelled).not.toContain('Overdue')
    expect(cancelled).not.toContain('Time remaining')
    expect(cancelled).toContain('Time given: 2 days')
  })
  it('shows the actual same-day allocation instead of zero days or a full 24 hours', () => {
    const requestedAt = new Date(2026, 9, 19, 12, 30, 15, 125).toISOString()
    vi.useFakeTimers({ now: new Date(requestedAt) })
    const item = sop()
    const assignment = { id: 'task-today', userId: 'First reviewer', decision: 'pending' as const, dueDate: '2026-10-19', assignedDueDays: 0, assignedAt: requestedAt }
    item.internalReviewRounds = [{ id: 'today', scope: 'internal', version: item.version, status: 'open', requestedById: 'Author', requestedAt, dueDate: '2026-10-19', assignedDueDays: 0, assignments: [assignment] }]
    const html = render(<ReviewerDeadline sop={item} reviewer={assignment} content={sopWorkflowEn.reviewerDeadline} />)
    expect(html).toContain('Time given: 11 hours 29 minutes')
    expect(html).toContain('Time remaining: 11 hours 29 minutes')
    expect(html).not.toContain('0 days')
    expect(html).not.toContain('24 hours')
    expect(html).not.toContain('Overdue')
    const summary = render(<InternalReviewSummary sop={item} />)
    expect(summary).toContain('Time given: 11 hours 29 minutes')
    expect(summary).toContain('Time remaining: 11 hours 29 minutes')
    expect(summary).not.toContain('Remaining days')
  })
  it('becomes overdue at the exact local end-of-day timestamp, including its last millisecond', () => {
    const requestedAt = new Date(2026, 9, 19, 12).toISOString()
    const deadline = new Date(2026, 9, 19, 23, 59, 59, 999).getTime()
    vi.useFakeTimers({ now: deadline - 1 })
    const item = sop()
    const assignment = { id: 'task-today', userId: 'First reviewer', decision: 'pending' as const, dueDate: '2026-10-19', assignedDueDays: 0, assignedAt: requestedAt }
    item.internalReviewRounds = [{ id: 'today', scope: 'internal', version: item.version, status: 'open', requestedById: 'Author', requestedAt, dueDate: '2026-10-19', assignedDueDays: 0, assignments: [assignment] }]
    expect(render(<ReviewerDeadline sop={item} reviewer={assignment} content={sopWorkflowEn.reviewerDeadline} />)).toContain('Time remaining: less than 1 second')
    expect(render(<InternalReviewSummary sop={item} />)).not.toContain('Overdue')
    vi.setSystemTime(deadline)
    const html = render(<ReviewerDeadline sop={item} reviewer={assignment} content={sopWorkflowEn.reviewerDeadline} />)
    expect(html).toContain('Overdue')
    expect(html).not.toContain('Time remaining')
    expect(render(<InternalReviewSummary sop={item} />)).toContain('Overdue')
  })
  it('retains distinct historical reviewer dates and allocations without active countdowns', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 1, 12) })
    const item = sop()
    const assignedAt = new Date(2026, 9, 18, 9).toISOString()
    const assignments = item.reviewers.slice(0, 2).map((person, index) => ({ ...person, id: 'old-' + index, assignedAt, decision: 'completed' as const }))
    item.internalReviewRounds = [
      { id: 'old-round', scope: 'internal', version: '1', status: 'completed', requestedById: 'Author', requestedAt: assignedAt, dueDate: '2026-10-30', assignedDueDays: 12, assignments },
      { id: 'new-round', scope: 'internal', version: '2', status: 'open', requestedById: 'Author', requestedAt: new Date().toISOString(), dueDate: '2026-11-01', assignedDueDays: 0, assignments: [] },
    ]
    item.version = '2'
    for (const [index, assignment] of assignments.entries()) {
      const html = render(<ReviewerDeadline sop={item} reviewer={assignment} content={sopWorkflowEn.reviewerDeadline} />)
      expect(html).toContain(`Time given: ${index === 0 ? '2' : '7'} days 14 hours`)
      expect(html).toContain(new Date(2026, 9, index === 0 ? 20 : 25, 23, 59, 59, 999).toISOString())
      expect(html).not.toContain('Time remaining')
      expect(html).not.toContain('Overdue')
    }
    expect(assignments.map((assignment) => assignment.dueDate)).toEqual(['2026-10-20', '2026-10-25'])
  })
  it('formats timestamp durations without rounding partial units up', () => {
    expect(formatReviewDuration(24 * 60 * 60 * 1_000 - 1)).toBe('23 hours 59 minutes')
    expect(formatReviewDuration(45_999)).toBe('45 seconds')
    expect(formatReviewDuration(999)).toBe('less than 1 second')
    expect(formatReviewDuration(45 * 24 * 60 * 60 * 1_000)).toBe('45 days')
  })
})
