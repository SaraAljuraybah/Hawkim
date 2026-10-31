import { describe, expect, it } from 'vitest'
import type { Sop, User } from '../data/mock/types'
import { reviewSopForUser } from '../lib/reviewAccess'
import { reviewTasks, reviewerTaskSection } from '../lib/reviews'
import { deriveNotifications, isDueNotification } from '../lib/notifications'
import { visibleSops } from './visibleSops'

const user: User = { id: 'reviewer', name: 'Reviewer', email: 'reviewer@example.test', initials: 'RR', departmentId: 'home', permissions: ['reviewer'] }
const source = (): Sop => ({
  id: 'versioned', code: 'SOP-001', title: 'Version-scoped SOP', departmentId: 'home', authorId: 'author', coAuthorIds: [], version: '2', status: 'in-review', lastUpdated: '2026-10-29', fileName: 'private-v2.pdf', fileType: 'pdf', fileUrl: '/private-v2.pdf',
  versions: [{ version: '1', fileName: 'old.pdf', fileType: 'pdf', fileUrl: '/old.pdf', uploadedAt: '2026-10-20T09:00:00Z' }, { version: '2', fileName: 'private-v2.pdf', fileType: 'pdf', fileUrl: '/private-v2.pdf', uploadedAt: '2026-10-29T09:00:00Z' }],
  internalReviewRounds: [
    { id: 'old', scope: 'internal', version: '1', status: 'open', requestedById: 'author', requestedAt: '2026-10-20T09:00:00Z', assignedDueDays: null, assignments: [{ id: 'old-task', userId: 'reviewer', decision: 'pending', assignedAt: '2026-10-20T09:00:00Z', responseDueDate: '2026-11-01' }] },
    { id: 'current', scope: 'internal', version: '2', status: 'open', requestedById: 'author', requestedAt: '2026-10-29T09:00:00Z', assignedDueDays: null, assignments: [{ id: 'new-task', userId: 'other', decision: 'pending', assignedAt: '2026-10-29T09:00:00Z' }] },
  ],
  reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [],
})

describe('repeated frontend historical projections', () => {
  it.each([false, true])('preserves read-only provenance and history grouping after a second projection (spread: %s)', (spread) => {
    const visible = visibleSops([source()], user, [])[0]
    const document = spread ? { ...visible } : visible
    const first = reviewSopForUser(document, user.id)!
    const second = reviewSopForUser(first.sop, user.id)!
    expect(first.historical).toBe(true)
    expect(second.historical).toBe(true)
    expect(second.sop.version).toBe('1')
    expect(second.sop.fileUrl).toBe('/old.pdf')
    const task = reviewTasks(user.id, [document], Date.parse('2026-10-29T09:00:00Z'))[0]
    expect(task.group).toBe('done')
    expect(task.need).toBeUndefined()
    expect(reviewerTaskSection(task)).toBe('completed')
    expect(JSON.stringify(document)).not.toContain('historical-review-projection')
  })

  it('keeps a historical Approver read-only after context and page projections', () => {
    const sop = source()
    sop.internalReviewRounds = []
    sop.approvalSubmissions = [{ id: 'v1-approval', version: '1', internalReviewRoundId: 'old', submittedById: 'author', submittedAt: '2026-10-20T09:00:00Z', approverId: 'reviewer', status: 'pending', assignedDueDays: null }]
    const approver: User = { ...user, permissions: ['approver'] }
    const document = visibleSops([sop], approver, [])[0]
    const page = reviewSopForUser(document, user.id)!
    expect(page.historical).toBe(true)
    expect(page.sop.version).toBe('1')
    expect(reviewTasks(user.id, [document])[0]).toMatchObject({ role: 'approver', group: 'done' })
    expect(reviewTasks(user.id, [document])[0].need).toBeUndefined()
  })

  it.each(['reviewer', 'approver'] as const)('keeps historical %s timeline notifications without due-soon or overdue reminders', (role) => {
    const sop = source()
    const dueAt = '2026-10-28T20:59:59.999Z'
    if (role === 'reviewer') {
      Object.assign(sop.internalReviewRounds![0].assignments[0], { decision: 'accepted', acceptedAt: '2026-10-20T09:30:00Z', reviewDueDate: '2026-10-28', reviewDueAt: dueAt })
      sop.timeline = [{ id: 'old-submission', type: 'submitted', actorId: 'author', version: '1', reviewRoundId: 'old', recipientIds: ['reviewer'], createdAt: '2026-10-20T09:00:00Z' }]
    } else {
      sop.internalReviewRounds = []
      sop.approvalSubmissions = [{ id: 'old-approval', version: '1', internalReviewRoundId: 'old', submittedById: 'author', submittedAt: '2026-10-20T09:00:00Z', approverId: user.id, status: 'pending', assignedDueDays: 2, dueDate: '2026-10-28' }]
      sop.timeline = [{ id: 'old-submission', type: 'submitted-for-approval', actorId: 'author', version: '1', approvalSubmissionId: 'old-approval', recipientIds: [user.id], createdAt: '2026-10-20T09:00:00Z' }]
    }
    const document = visibleSops([sop], { ...user, permissions: [role] }, [])[0]
    for (const now of [Date.parse(dueAt) - 60 * 60 * 1000, Date.parse(dueAt) + 1]) {
      const notifications = deriveNotifications(user.id, { sops: [document], requests: [], now })
      expect(notifications.filter((item) => isDueNotification(item.type))).toEqual([])
      expect(notifications).toEqual([expect.objectContaining({ type: role === 'reviewer' ? 'assigned-review' : 'assigned-approval', version: '1' })])
    }
  })

  it.each(['reviewer', 'approver'] as const)('preserves active %s reminders through the same frontend projection', (role) => {
    const sop = source()
    const dueAt = '2026-10-28T20:59:59.999Z'
    sop.version = '1'
    sop.internalReviewRounds = [sop.internalReviewRounds![0]]
    if (role === 'reviewer') {
      Object.assign(sop.internalReviewRounds![0].assignments[0], { decision: 'accepted', acceptedAt: '2026-10-20T09:30:00Z', reviewDueDate: '2026-10-28', reviewDueAt: dueAt })
    } else {
      sop.status = 'in-approval'
      sop.internalReviewRounds[0] = { ...sop.internalReviewRounds[0], status: 'completed', assignments: [{ ...sop.internalReviewRounds[0].assignments[0], userId: 'other', decision: 'completed', decidedAt: '2026-10-20T10:00:00Z' }] }
      sop.reviewers = [{ userId: 'other', decision: 'completed' }]
      sop.approvers = [{ id: 'approval-task', userId: user.id, version: '1', decision: 'pending' }]
      sop.approvalDueAt = dueAt
      sop.approvalSubmissions = [{ id: 'approval-task', version: '1', internalReviewRoundId: 'old', submittedById: 'author', submittedAt: '2026-10-20T09:00:00Z', approverId: user.id, status: 'pending', assignedDueDays: 2, dueDate: '2026-10-28' }]
      sop.externalReviewGate = { requirement: 'not-required', version: '1', internalReviewRoundId: 'old', confirmedById: 'author', confirmedAt: '2026-10-20T10:30:00Z' }
    }
    const document = visibleSops([sop], { ...user, permissions: [role] }, [])[0]
    const before = deriveNotifications(user.id, { sops: [document], requests: [], now: Date.parse(dueAt) - 60 * 60 * 1000 })
    expect(before.filter((item) => isDueNotification(item.type))).toEqual([expect.objectContaining({ type: 'due-soon' })])
    const after = deriveNotifications(user.id, { sops: [document], requests: [], now: Date.parse(dueAt) + 1 })
    expect(after.filter((item) => isDueNotification(item.type))).toEqual([expect.objectContaining({ type: 'overdue' })])
  })
})
