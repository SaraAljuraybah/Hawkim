import { describe, expect, it } from 'vitest'
import type { ComplianceCheck, Sop, User, UserRequest } from '../data/mock/types'
import { decideRequest } from './requestAdmin'
import { deriveNotifications, isRead, type AppNotification } from './notifications'
import {
  approveAs,
  completeReview,
  publishAs,
  resubmit,
  returnAsApprover,
  routeToReviewer,
  submitForReview,
  uploadNewVersion,
} from './workflow'

/*
 * Sara writes SOP-001 (IT) with co-author Reem. Noura and Faisal review, Lama (PV)
 * can be routed in; Huda and Khalid approve.
 */
const GVP = '4.0'
const HOUR = 60 * 60 * 1000

function check(version: string): ComplianceCheck {
  return {
    id: `chk-${version}`,
    sopId: 'sop-1',
    version,
    status: 'completed',
    startedAt: '2026-01-01T09:00:00Z',
    guideline: { name: 'GVP', version: GVP },
    findings: [],
  }
}

function draft(): Sop {
  return {
    id: 'sop-1',
    code: 'SOP-001',
    title: 'Test SOP',
    departmentId: 'information-technology',
    version: '1.0',
    status: 'draft',
    lastUpdated: '2026-01-01',
    authorId: 'sara',
    coAuthorIds: ['reem'],
    fileName: 'SOP-001.pdf',
    fileType: 'pdf',
    reviewers: [],
    approvers: [],
    versions: [{ version: '1.0', fileName: 'SOP-001.pdf', fileType: 'pdf', uploadedAt: '2026-01-01T08:00:00Z' }],
    comments: [],
    timeline: [],
    complianceChecks: [check('1.0')],
  }
}

const lama: User = {
  id: 'lama',
  name: 'Lama',
  email: 'lama@hawkim.demo',
  initials: 'LA',
  departmentId: 'pharmacovigilance',
  permissions: ['reviewer'],
}

const submit = (days?: number) => submitForReview(draft(), 'sara', GVP, ['noura', 'faisal'], ['huda', 'khalid'], days, days)
const inApproval = () => completeReview(completeReview(submit(), 'noura'), 'faisal')
const approved = () => approveAs(approveAs(inApproval(), 'huda'), 'khalid')

/** "type via" for each of the user's notifications, oldest first. */
function kinds(userId: string, sops: Sop[], now = Date.now(), requests: UserRequest[] = []) {
  return deriveNotifications(userId, { sops, requests, now })
    .reverse()
    .map((notification) => [notification.type, notification.via].filter(Boolean).join(' '))
}

describe('assigned to me', () => {
  it('notifies the reviewers at submission, but not the approvers or the author', () => {
    const sop = submit()
    expect(kinds('noura', [sop])).toEqual(['assigned-review submitted'])
    expect(kinds('faisal', [sop])).toEqual(['assigned-review submitted'])
    expect(kinds('huda', [sop])).toEqual([])
    expect(kinds('khalid', [sop])).toEqual([])
    expect(kinds('sara', [sop])).toEqual([])
  })

  it('notifies a routed reviewer', () => {
    const sop = routeToReviewer(submit(), 'faisal', lama)
    expect(kinds('lama', [sop])).toEqual(['assigned-review routed'])
    const notification = deriveNotifications('lama', { sops: [sop], requests: [], now: Date.now() })[0]
    expect(notification).toMatchObject({ actorId: 'faisal', sopCode: 'SOP-001', version: '1.0', link: '/reviews/sop-1' })
  })

  it('notifies the approvers when the SOP moves to In Approval, and again when it is approved', () => {
    expect(kinds('huda', [inApproval()])).toEqual(['assigned-approval'])
    expect(kinds('khalid', [approved()])).toEqual(['assigned-approval', 'ready-to-publish'])
  })
})

describe('my SOP (author and co-authors)', () => {
  it('tells the author and co-authors who returned it', () => {
    const returned = returnAsApprover(approveAs(inApproval(), 'huda'), 'khalid', 'Fix section 5.')
    for (const writer of ['sara', 'reem']) {
      const [notification] = deriveNotifications(writer, { sops: [returned], requests: [], now: Date.now() })
      expect(notification, writer).toMatchObject({ type: 'sop-returned', actorId: 'khalid', version: '1.0', link: '/my-sops/sop-1' })
    }
    expect(kinds('noura', [returned])).toEqual(['assigned-review submitted'])
  })

  it('tells them when it is approved and published', () => {
    const published = publishAs(approved(), 'huda')
    expect(kinds('sara', [published])).toEqual(['sop-approved', 'sop-published'])
    expect(kinds('reem', [published])).toEqual(['sop-approved', 'sop-published'])
    // The approver who published isn't told about their own action.
    expect(kinds('huda', [published])).toEqual(['assigned-approval', 'ready-to-publish'])
  })

  it('says "resubmitted" to the reviewers on a resubmission', () => {
    const returned = returnAsApprover(inApproval(), 'huda', 'Fix it.')
    const updated = uploadNewVersion(returned, 'sara', { fileName: 'v1.1.pdf', fileType: 'pdf' })
    const again = resubmit({ ...updated, complianceChecks: [...updated.complianceChecks, check('1.1')] }, 'sara', GVP)
    expect(kinds('noura', [again])).toEqual(['assigned-review submitted', 'assigned-review resubmitted'])
    expect(deriveNotifications('noura', { sops: [again], requests: [], now: Date.now() })[0].version).toBe('1.1')
  })
})

describe('due soon and overdue', () => {
  it('is due soon within 24 hours, overdue once passed, and nothing before', () => {
    const sop = submit(2) // review due in two days
    const due = new Date(sop.reviewDueAt!).getTime()
    const at = (ms: number) => kinds('noura', [sop], ms).filter((kind) => kind === 'due-soon' || kind === 'overdue')
    expect(at(due - 25 * HOUR)).toEqual([])
    expect(at(due - 23 * HOUR)).toEqual(['due-soon'])
    expect(at(due + 1)).toEqual(['overdue'])
    const [overdue] = deriveNotifications('noura', { sops: [sop], requests: [], now: due + HOUR })
    expect(overdue).toMatchObject({ type: 'overdue', stage: 'review', createdAt: sop.reviewDueAt, link: '/reviews/sop-1' })
  })

  it('is only for people with a pending decision in the open stage, and only with a due date', () => {
    const sop = completeReview(submit(2), 'noura')
    const late = new Date(sop.reviewDueAt!).getTime() + HOUR
    expect(kinds('noura', [sop], late)).not.toContain('overdue')
    expect(kinds('faisal', [sop], late)).toContain('overdue')
    expect(kinds('huda', [sop], late)).not.toContain('overdue') // approval hasn't started
    expect(kinds('faisal', [submit()], Date.now() + 365 * 24 * HOUR)).not.toContain('overdue')
  })

  it('keeps the same id within a round and a new one after a resubmit', () => {
    const sop = submit(2)
    const late = new Date(sop.reviewDueAt!).getTime() + HOUR
    const id = (item: Sop, now: number) => deriveNotifications('faisal', { sops: [item], requests: [], now })[0].id
    const first = id(sop, late)
    expect(id(sop, late + 48 * HOUR)).toBe(first)

    const returned = returnAsApprover(approveAs(completeReview(completeReview(sop, 'noura'), 'faisal'), 'huda'), 'khalid', 'x')
    const updated = uploadNewVersion(returned, 'sara', { fileName: 'v1.1.pdf', fileType: 'pdf' })
    const again = resubmit({ ...updated, complianceChecks: [...updated.complianceChecks, check('1.1')] }, 'sara', GVP)
    const lateAgain = new Date(again.reviewDueAt!).getTime() + HOUR
    expect(id(again, lateAgain)).not.toBe(first)
  })
})

describe('my requests', () => {
  const request: UserRequest = {
    id: 'req-1',
    title: 'Access to Quality Assurance',
    type: 'department-access',
    departmentId: 'quality-assurance',
    description: '',
    createdAt: '2026-10-01',
    status: 'pending',
    requesterId: 'sara',
  }

  it('tells the requester when it is approved or rejected', () => {
    const approvedRequest = decideRequest(request, 'approved', 'nouf', '2026-10-02T09:00:00Z')
    expect(kinds('sara', [], Date.now(), [approvedRequest])).toEqual(['request-approved'])
    expect(kinds('sara', [], Date.now(), [decideRequest(request, 'rejected', 'nouf')])).toEqual(['request-rejected'])
    expect(kinds('reem', [], Date.now(), [approvedRequest])).toEqual([])
    expect(kinds('sara', [], Date.now(), [request])).toEqual([])
  })

  it('doesn’t notify decisions without a record of when they were made (sample history)', () => {
    expect(kinds('sara', [], Date.now(), [{ ...request, status: 'approved' }])).toEqual([])
  })
})

describe('read state', () => {
  const notification = (type: AppNotification['type'], createdAt: string): AppNotification => ({
    id: `${type}-${createdAt}`,
    type,
    createdAt,
    link: '/',
  })
  const sessionStart = Date.parse('2026-10-06T08:00:00Z')

  it('counts what happened before the session as read, except due-soon and overdue', () => {
    expect(isRead(notification('sop-returned', '2026-10-05T08:00:00Z'), new Set(), sessionStart)).toBe(true)
    expect(isRead(notification('overdue', '2026-10-05T08:00:00Z'), new Set(), sessionStart)).toBe(false)
    expect(isRead(notification('due-soon', '2026-10-05T08:00:00Z'), new Set(), sessionStart)).toBe(false)
  })

  it('keeps what happens during the session unread until opened or marked as read', () => {
    const item = notification('assigned-review', '2026-10-06T09:00:00Z')
    expect(isRead(item, new Set(), sessionStart)).toBe(false)
    expect(isRead(item, new Set([item.id]), sessionStart)).toBe(true)
    const overdue = notification('overdue', '2026-10-05T08:00:00Z')
    expect(isRead(overdue, new Set([overdue.id]), sessionStart)).toBe(true)
  })
})
