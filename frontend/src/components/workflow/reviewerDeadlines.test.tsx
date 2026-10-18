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
    expect(active).toContain('Time Given: 2 Days')
    expect(active).toContain('Time Remaining: 1 Day')
    expect(active).toContain('Current reviewer')
    const waiting = render(<ReviewerDeadline sop={item} reviewer={item.reviewers[1]} content={sopWorkflowEn.reviewerDeadline} showQueue />)
    expect(waiting).toContain('Time Given: 7 Days')
    expect(waiting).toContain('Waiting in queue')
    expect(waiting).not.toContain('Time Remaining')
    const blank = render(<ReviewerDeadline sop={item} reviewer={item.reviewers[2]} content={sopWorkflowEn.reviewerDeadline} />)
    expect(blank).toContain('No deadline assigned')
    expect(blank).not.toContain('<time')
  })
  it('shows each reviewer allocation in resubmission without approver names or durations', () => {
    const html = render(<ResubmitDialog sop={sop()} content={sopWorkflowEn.dialogs} onSubmit={() => {}} onClose={() => {}} />)
    for (const text of ['First reviewer', 'Next reviewer', 'No deadline reviewer', 'Time Given', '2 days', '7 days', 'No due date']) expect(html).toContain(text)
    for (const text of ['Approval person', 'Second approver', '3 days', 'Approval due', 'Approvers']) expect(html).not.toContain(text)
  })
  it('shows queue positions and individual deadlines in PeopleList', () => {
    const html = render(<PeopleList sop={sop()} content={sopWorkflowEn.people} userId="Author" canManageCoAuthors={false} onAddCoAuthor={() => {}} onRemoveCoAuthor={() => {}} />)
    expect(html).toContain('Current reviewer')
    expect(html).toContain('Waiting in queue')
    expect(html).toContain('Time Given: 2 Days')
    expect(html).toContain('Time Given: 7 Days')
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
