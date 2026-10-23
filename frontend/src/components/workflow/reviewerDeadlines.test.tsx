import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { Sop } from '../../data/mock/types'
import { UsersContext, type UsersStore } from '../../state/usersContext'
import { ReviewerDeadline } from './ReviewerDeadline'
import { ResubmitDialog } from './ResubmitDialog'
import { PeopleList } from './PeopleList'
import { StatusTracker } from './StatusTracker'
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
    expect(active).toContain('Time Remaining: 1 Day')
    expect(active).toContain('Current reviewer')
    const waiting = render(<ReviewerDeadline sop={item} reviewer={item.reviewers[1]} content={sopWorkflowEn.reviewerDeadline} showQueue />)
    expect(waiting).toContain('Time given: 7 days')
    expect(waiting).toContain('Waiting in queue')
    expect(waiting).not.toContain('Time Remaining')
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
      expect(html).toContain('Time Remaining')
      expect(html).not.toContain('Waiting in queue')
    }
    const html = render(<StatusTracker sop={item} content={sopWorkflowEn.tracker} />)
    expect(html).toContain('First reviewer, Next reviewer, No deadline reviewer')
    expect(html).toContain('Overall Review Request Due Date')
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
    expect(cancelled).not.toContain('Time Remaining')
    expect(cancelled).toContain('Time given: 2 days')
  })
})
