import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Sop, User } from '../data/mock/types'
import { ReviewPage } from '../pages/ReviewPage'
import { ReviewsPage } from '../pages/ReviewsPage'
import { internalReviewEn } from '../content/internalReview.en'
import { reviewsEn } from '../content/reviews.en'
import { deriveNotifications } from './notifications'
import { reviewSopForUser } from './reviewAccess'
import { reviewTasks } from './reviews'
import { activeApprovalSubmission, approveAs, publishAs, returnAsApprover, uploadVersion } from './workflow'

const state = vi.hoisted(() => ({ sop: null as Sop | null, userId: 'controller', users: [
  { id: 'controller', name: 'Quality Controller', permissions: ['approver'], departmentId: 'home' },
  { id: 'reviewer', name: 'Internal Reviewer', permissions: ['reviewer'], departmentId: 'home' },
  { id: 'author', name: 'Main Author', permissions: ['author'], departmentId: 'home' },
  { id: 'outsider', name: 'Other Employee', permissions: ['reviewer', 'approver'], departmentId: 'other' },
] as User[] }))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => state.users.find((user) => user.id === state.userId) }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({
  users: state.users, activeUsers: state.users,
  nameOf: (id: string) => state.users.find((user) => user.id === id)?.name ?? id,
  getUser: (id: string) => state.users.find((user) => user.id === id),
}) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [], nameOf: (id: string) => id }) }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: [state.sop] }) }))

const requestedAt = '2026-10-23T09:00:00.000Z'
const dueAt = new Date('2026-10-27T23:59:59.999').toISOString()
const snapshot = { version: '1', approvalSubmissionId: 'approval-1' }
function inApproval(): Sop {
  const assignments = [{ id: 'review-1', userId: 'reviewer', decision: 'completed' as const, assignedAt: requestedAt, decidedAt: requestedAt, assignedDueDays: 2, dueDate: '2026-10-25' }]
  return {
    id: 'test', code: 'SOP-TEST', title: 'Approval phase fixture', description: 'Description preserved\nSecond line',
    authorId: 'author', coAuthorIds: [], departmentId: 'home', version: '1', status: 'in-approval', lastUpdated: '2026-10-23',
    fileName: 'version-one.docx', fileType: 'docx', fileUrl: '/version-one.docx',
    versions: [{ version: '1', fileName: 'version-one.docx', fileType: 'docx', fileUrl: '/version-one.docx', uploadedAt: requestedAt, uploadedById: 'author' }],
    reviewers: assignments,
    internalReviewRounds: [{ id: 'internal-1', scope: 'internal', version: '1', status: 'completed', requestedById: 'author', requestedAt, assignedDueDays: 3, dueDate: '2026-10-26', closedAt: requestedAt, assignments }],
    externalReviewGate: { version: '1', internalReviewRoundId: 'internal-1', requirement: 'not-required', confirmedById: 'author', confirmedAt: requestedAt },
    approvers: [{ id: snapshot.approvalSubmissionId, userId: 'controller', version: '1', decision: 'pending', assignedAt: requestedAt }],
    approvalSubmissions: [{ id: snapshot.approvalSubmissionId, version: '1', internalReviewRoundId: 'internal-1', submittedById: 'author', submittedAt: requestedAt, approverId: 'controller', status: 'pending', assignedDueDays: 4, dueDate: '2026-10-27' }],
    approvalDueDays: 4, approvalDueAt: dueAt,
    comments: [], complianceChecks: [], timeline: [
      { id: 'no-external', type: 'external-reviews-not-required', actorId: 'author', createdAt: requestedAt, version: '1', reviewRoundId: 'internal-1' },
      { id: 'submitted-approval', type: 'submitted-for-approval', actorId: 'author', createdAt: requestedAt, version: '1', approvalSubmissionId: snapshot.approvalSubmissionId, reviewRoundId: 'internal-1', recipientIds: ['controller'] },
      { id: 'approval-due', type: 'stage-due-date-set', actorId: 'author', createdAt: requestedAt, version: '1', stage: 'approval', dueAt },
    ],
  }
}
function notifications(sop: Sop, userId: string, now = Date.parse(dueAt) - 60 * 60 * 1000) {
  return deriveNotifications(userId, { sops: [sop], requests: [], now })
}
function render(page: 'detail' | 'list') {
  return renderToStaticMarkup(<MemoryRouter initialEntries={['/test']}><Routes><Route path="/:id" element={page === 'detail' ? <ReviewPage /> : <ReviewsPage />} /></Routes></MemoryRouter>)
}
beforeEach(() => { state.sop = inApproval(); state.userId = 'controller'; state.users[0].permissions = ['approver'] })

describe('explicit approval phase with retained internal review history', () => {
  it('creates an actionable approval task with the approval deadline, keeping the completed internal task done', () => {
    expect(activeApprovalSubmission(state.sop!)).toMatchObject({ id: snapshot.approvalSubmissionId })
    expect(reviewTasks('controller', [state.sop!])[0]).toMatchObject({ role: 'approver', group: 'todo', need: 'approval', dueAt })
    expect(reviewTasks('reviewer', [state.sop!])[0]).toMatchObject({ role: 'reviewer', group: 'done', decision: 'completed' })
    expect(reviewTasks('outsider', [state.sop!])).toEqual([])
  })

  it('notifies only the assigned Approver and uses approval reminders independently of closed review deadlines', () => {
    expect(notifications(state.sop!, 'controller')).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assigned-approval', actorId: 'author', version: '1', link: '/reviews/test' }),
      expect.objectContaining({ type: 'due-soon', stage: 'approval', dueAt }),
    ]))
    expect(notifications(state.sop!, 'reviewer')).toEqual([])
    expect(notifications(state.sop!, 'outsider')).toEqual([])
    expect(notifications(state.sop!, 'author')).toEqual([])
    const overdue = notifications(state.sop!, 'controller', Date.parse(dueAt) + 1)
    expect(overdue.some((item) => item.type === 'overdue' && item.stage === 'approval')).toBe(true)
  })

  it('preserves Approve, then Publish tasks and author notifications without restarting internal reviews', () => {
    const internalHistory = JSON.stringify(state.sop!.internalReviewRounds)
    const approved = approveAs(state.sop!, 'controller', 'Ready', snapshot)
    expect(reviewTasks('controller', [approved])[0]).toMatchObject({ group: 'todo', need: 'publish' })
    expect(notifications(approved, 'controller').map((item) => item.type)).toContain('ready-to-publish')
    expect(notifications(approved, 'controller').some((item) => item.type === 'due-soon' || item.type === 'overdue')).toBe(false)
    expect(notifications(approved, 'author').map((item) => item.type)).toContain('sop-approved')
    const published = publishAs(approved, 'controller', snapshot)
    expect(reviewTasks('controller', [published])[0]).toMatchObject({ group: 'done', decision: 'approved' })
    expect(notifications(published, 'author').map((item) => item.type)).toContain('sop-published')
    expect(JSON.stringify(published.internalReviewRounds)).toBe(internalHistory)
  })

  it('returns immediately with a required reason, stops reminders, and preserves approval feedback', () => {
    expect(() => returnAsApprover(state.sop!, 'controller', '  ', snapshot)).toThrow('A comment is required')
    const returned = returnAsApprover(state.sop!, 'controller', 'Revise section four', snapshot)
    expect(returned.status).toBe('returned')
    expect(returned.comments.at(-1)).toMatchObject({ text: 'Revise section four', role: 'approver', version: '1' })
    expect(notifications(returned, 'author').map((item) => item.type)).toContain('sop-returned')
    expect(notifications(returned, 'controller').some((item) => item.type === 'due-soon' || item.type === 'overdue')).toBe(false)
  })

  it('does not create actionable tasks or reminders for a stale approval marker', () => {
    state.sop!.approvalSubmissions![0].version = 'older'
    expect(activeApprovalSubmission(state.sop!)).toBeUndefined()
    expect(reviewTasks('controller', [state.sop!]).some((task) => task.group === 'todo')).toBe(false)
    expect(notifications(state.sop!, 'controller').some((item) => item.type === 'due-soon' || item.type === 'overdue')).toBe(false)
  })
})

describe('approval and prior-version detail access', () => {
  it('shows approval actions, preserved descriptions, and approval status without an awaiting-Author prompt', () => {
    const detail = render('detail')
    expect(detail).toContain(`>${reviewsEn.page.actions.approve}</button>`)
    expect(detail).toContain(`>${reviewsEn.page.actions.returnToAuthor}</button>`)
    expect(detail).toContain('Description preserved\nSecond line')
    expect(detail).not.toContain(internalReviewEn.status.awaitingAuthor)
    expect(detail).not.toContain(internalReviewEn.panel.states.completed)
    expect(detail).not.toContain(`>${reviewsEn.page.actions.completeReview}</button>`)
    const list = render('list')
    expect(list).toContain('Approval phase fixture')
    expect(list).toContain(reviewsEn.list.needs.approval)
    expect(list).toContain(`dateTime="${dueAt}"`)
  })

  it('shows Publish after approval and publication status after publishing', () => {
    state.sop = approveAs(state.sop!, 'controller', undefined, snapshot)
    expect(render('detail')).toContain(`>${reviewsEn.page.actions.publish}</button>`)
    state.sop = publishAs(state.sop, 'controller', snapshot)
    const html = render('detail')
    expect(html).not.toContain(`>${reviewsEn.page.actions.publish}</button>`)
    expect(html).toContain('Published on')
    expect(html).not.toContain(internalReviewEn.status.awaitingAuthor)
  })

  it('hides modern approval and publication controls if the assigned user loses Approver permission', () => {
    state.users[0].permissions = ['reviewer']
    expect(render('detail')).not.toContain(`>${reviewsEn.page.actions.approve}</button>`)
    expect(render('detail')).not.toContain(`>${reviewsEn.page.actions.returnToAuthor}</button>`)
    state.sop = approveAs(state.sop!, 'controller', undefined, snapshot)
    expect(render('detail')).not.toContain(`>${reviewsEn.page.actions.publish}</button>`)
  })

  it('keeps a former approver on their assigned version after an Author revision, even when current approvers are cleared', () => {
    const returned = returnAsApprover(state.sop!, 'controller', 'Please revise', snapshot)
    const revised = uploadVersion(returned, 'author', { fileName: 'private-version-two.docx', fileType: 'docx', fileUrl: '/private-version-two.docx' })
    revised.approvers = []
    revised.externalReviewGate = { version: revised.version, internalReviewRoundId: 'internal-2', requirement: 'not-required', confirmedById: 'author', confirmedAt: requestedAt }
    const history = JSON.stringify(revised.approvalSubmissions)
    const access = reviewSopForUser(revised, 'controller')!
    expect(access.historical).toBe(true)
    expect(access.sop).toMatchObject({ version: '1', status: 'returned', fileUrl: '/version-one.docx' })
    expect(access.sop.externalReviewGate).toBeUndefined()
    expect(JSON.stringify(access)).not.toContain('private-version-two')
    expect(reviewTasks('controller', [revised])[0]).toMatchObject({ group: 'done', decision: 'returned' })
    expect(JSON.stringify(revised.approvalSubmissions)).toBe(history)
    state.sop = revised
    const html = render('detail')
    expect(html).toContain('Please revise')
    expect(html).not.toContain('private-version-two')
    expect(html).not.toContain(`>${reviewsEn.page.actions.approve}</button>`)
    expect(html).not.toContain(`>${reviewsEn.page.actions.publish}</button>`)
  })

  it('keeps historical internal reviewers from seeing later approval documents or their review reports', () => {
    const returned = returnAsApprover(state.sop!, 'controller', 'Please revise', snapshot)
    const revised = uploadVersion(returned, 'author', { fileName: 'private-version-two.docx', fileType: 'docx', fileUrl: '/private-version-two.docx' })
    const access = reviewSopForUser(revised, 'reviewer')!
    expect(access.historical).toBe(true)
    expect(access.sop.version).toBe('1')
    expect(JSON.stringify(access)).not.toContain('private-version-two')
    expect(reviewSopForUser(revised, 'outsider')).toBeUndefined()
  })
})
