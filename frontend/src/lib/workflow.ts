import {
  SYSTEM_ACTOR,
  type ApproverAssignment,
  type ReviewerAssignment,
  type Sop,
  type SopComment,
  type SopVersion,
  type TimelineEvent,
  type TimelineEventType,
} from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { todayIsoDate } from './format'

/*
 * SOP workflow rules (Sprint 0, PBI 2 / 3 / 6 / 8 / 12 / 22 / 24) as pure functions.
 * Each transition returns an updated copy of the SOP — status, people, due dates,
 * versions, comments, timeline and lastUpdated change together — or throws if the
 * action isn't allowed.
 *
 * Draft → In Review → (Returned) → In Approval → Approved → Published
 * - Reviewers work in parallel: In Approval only when ALL reviewers completed;
 *   ANY reviewer return sends the SOP back to the author at once.
 * - Approvers work the same way: Approved only when ALL approved; ANY return → Returned.
 * - Any assigned approver can publish once Approved.
 * - Separation of duties: the author and co-authors are never reviewers or approvers,
 *   and nobody is both a reviewer and an approver on the same SOP.
 *
 * TODO: The backend must enforce these same rules; the browser only reflects them.
 */

/** A file the author uploads (only its name, type and an in-memory URL are kept). */
export interface UploadedFile {
  fileName: string
  fileType: Sop['fileType']
  fileUrl?: string
}

/** Allowed range for each stage's due days. */
export const DUE_DAYS_MIN = 1
export const DUE_DAYS_MAX = 30

const DAY_MS = 24 * 60 * 60 * 1000

let counter = 0
function newId(prefix: string) {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

/** `iso` plus a number of calendar days, as an ISO date and time. */
export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString()
}

export function isValidDueDays(days: number): boolean {
  return Number.isInteger(days) && days >= DUE_DAYS_MIN && days <= DUE_DAYS_MAX
}

/** Version + 0.1 in decimal steps: 1.0 → 1.1, 1.9 → 2.0. */
export function nextVersion(version: string): string {
  return ((Math.round(Number(version) * 10) + 1) / 10).toFixed(1)
}

// ---------- Who is who ----------

export function isAuthor(sop: Sop, userId: string): boolean {
  return sop.authorId === userId
}

export function isCoAuthor(sop: Sop, userId: string): boolean {
  return sop.coAuthorIds.includes(userId)
}

/** Main author or co-author: can open the workflow page and change the file. */
export function isAuthorOrCoAuthor(sop: Sop, userId: string): boolean {
  return isAuthor(sop, userId) || isCoAuthor(sop, userId)
}

export function isReviewer(sop: Sop, userId: string): boolean {
  return sop.reviewers.some((person) => person.userId === userId)
}

export function isApprover(sop: Sop, userId: string): boolean {
  return sop.approvers.some((person) => person.userId === userId)
}

/** Reviewers or approvers who still have to decide in the current stage. */
export function pendingPeople(sop: Sop): { userId: string; role: 'reviewer' | 'approver' }[] {
  if (sop.status === 'in-review') {
    return sop.reviewers.filter((p) => p.decision === 'pending').map((p) => ({ userId: p.userId, role: 'reviewer' }))
  }
  if (sop.status === 'in-approval') {
    return sop.approvers.filter((p) => p.decision === 'pending').map((p) => ({ userId: p.userId, role: 'approver' }))
  }
  return []
}

// ---------- Due dates (PBI 3) ----------

/** The due date of the open stage (review or approval), if any. */
export function currentDueAt(sop: Sop): string | undefined {
  if (sop.status === 'in-review') return sop.reviewDueAt
  if (sop.status === 'in-approval') return sop.approvalDueAt
  return undefined
}

/** Overdue = past the due date while that stage is still open. Only a label; nothing happens automatically. */
export function isOverdue(sop: Sop, stage: 'review' | 'approval', now = Date.now()): boolean {
  const open = stage === 'review' ? sop.status === 'in-review' : sop.status === 'in-approval'
  const dueAt = stage === 'review' ? sop.reviewDueAt : sop.approvalDueAt
  return open && !!dueAt && new Date(dueAt).getTime() < now
}

// ---------- Returns and feedback ----------

/** The most recent "returned" event, if any. */
export function latestReturn(sop: Sop): TimelineEvent | undefined {
  return [...sop.timeline].reverse().find((item) => item.type === 'returned')
}

/** The step an SOP was returned from: In Review (a reviewer) or In Approval (an approver). */
export function returnedFrom(sop: Sop): 'in-review' | 'in-approval' | undefined {
  const returned = latestReturn(sop)
  if (!returned) return undefined
  return isApprover(sop, returned.actorId) ? 'in-approval' : 'in-review'
}

/** Comments left with the most recent return (shown in the feedback panel while Returned). */
export function latestReturnComments(sop: Sop): SopComment[] {
  const returned = latestReturn(sop)
  if (!returned) return []
  return sop.comments.filter(
    (comment) => comment.version === returned.version && comment.authorUserId === returned.actorId,
  )
}

/** A returned SOP can be resubmitted only after a new version was uploaded since the return (PBI 6). */
export function canResubmit(sop: Sop): boolean {
  if (sop.status !== 'returned') return false
  const returned = latestReturn(sop)
  return !!returned && sop.version !== returned.version
}

// ---------- Helpers ----------

function event(
  sop: Sop,
  type: TimelineEventType,
  actorId: string,
  extra: Partial<Omit<TimelineEvent, 'id' | 'type' | 'actorId' | 'version'>> = {},
): TimelineEvent {
  return { id: newId('evt'), type, actorId, version: sop.version, createdAt: new Date().toISOString(), ...extra }
}

function assertStatus(sop: Sop, allowed: SopStatus[], action: string) {
  if (!allowed.includes(sop.status)) throw new Error(`Can't ${action} an SOP that is ${sop.status}`)
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** The author and co-authors (who receive a returned SOP). */
function authors(sop: Sop): string[] {
  return [sop.authorId ?? '', ...sop.coAuthorIds].filter(Boolean)
}

/** Checks separation of duties for a set of reviewers and approvers. */
function assertSeparation(sop: Sop, reviewerIds: string[], approverIds: string[]) {
  assert(reviewerIds.length > 0, 'Select at least one reviewer')
  assert(approverIds.length > 0, 'Select at least one approver')
  const writers = authors(sop)
  assert(
    ![...reviewerIds, ...approverIds].some((id) => writers.includes(id)),
    'The author and co-authors cannot review or approve',
  )
  assert(!reviewerIds.some((id) => approverIds.includes(id)), 'Nobody can be both a reviewer and an approver')
}

// ---------- Author actions ----------

/**
 * Author: first submission (PBI 6). The author picks one or more reviewers and
 * approvers and the due days per stage (PBI 3).
 */
export function submitForReview(
  sop: Sop,
  actorId: string,
  reviewerIds: string[],
  approverIds: string[],
  reviewDueDays: number,
  approvalDueDays: number,
  note?: string,
): Sop {
  assertStatus(sop, ['draft'], 'submit')
  assert(isAuthor(sop, actorId), 'Only the author can submit this SOP')
  assertSeparation(sop, reviewerIds, approverIds)
  assert(isValidDueDays(reviewDueDays) && isValidDueDays(approvalDueDays), 'Due days must be from 1 to 30')
  const createdAt = new Date().toISOString()
  const reviewDueAt = addDays(createdAt, reviewDueDays)
  return {
    ...sop,
    status: 'in-review',
    reviewers: reviewerIds.map((userId): ReviewerAssignment => ({ userId, decision: 'pending' })),
    approvers: approverIds.map((userId): ApproverAssignment => ({ userId, decision: 'pending' })),
    reviewDueDays,
    approvalDueDays,
    reviewDueAt,
    approvalDueAt: undefined,
    lastUpdated: todayIsoDate(),
    timeline: [
      ...sop.timeline,
      { ...event(sop, 'submitted', actorId, { recipientIds: reviewerIds, ...(note ? { note } : {}) }), createdAt },
      { ...event(sop, 'stage-due-date-set', actorId, { stage: 'review', dueAt: reviewDueAt }), createdAt },
    ],
  }
}

/**
 * Author: resubmit after a new version. Same reviewers, approvers and due days;
 * everyone's decision resets and it goes through review and approval again.
 */
export function resubmit(sop: Sop, actorId: string, note?: string): Sop {
  assert(isAuthor(sop, actorId), 'Only the author can resubmit this SOP')
  assert(canResubmit(sop), 'Upload a new version before resubmitting')
  const createdAt = new Date().toISOString()
  const reviewDueAt = addDays(createdAt, sop.reviewDueDays ?? DUE_DAYS_MIN)
  const reviewerIds = sop.reviewers.map((p) => p.userId)
  return {
    ...sop,
    status: 'in-review',
    reviewers: sop.reviewers.map((p) => ({ userId: p.userId, decision: 'pending' })),
    approvers: sop.approvers.map((p) => ({ userId: p.userId, decision: 'pending' })),
    reviewDueAt,
    approvalDueAt: undefined,
    lastUpdated: todayIsoDate(),
    timeline: [
      ...sop.timeline,
      { ...event(sop, 'resubmitted', actorId, { recipientIds: reviewerIds, ...(note ? { note } : {}) }), createdAt },
      { ...event(sop, 'stage-due-date-set', actorId, { stage: 'review', dueAt: reviewDueAt }), createdAt },
    ],
  }
}

/** Author or co-author: replace the draft's file; the version stays the same. */
export function replaceFile(sop: Sop, actorId: string, file: UploadedFile): Sop {
  assertStatus(sop, ['draft'], 'replace the file of')
  assert(isAuthorOrCoAuthor(sop, actorId), 'Only the author or a co-author can replace the file')
  const current: SopVersion = { ...sop.versions[sop.versions.length - 1], ...file, uploadedAt: new Date().toISOString() }
  return {
    ...sop,
    ...file,
    lastUpdated: todayIsoDate(),
    versions: [...sop.versions.slice(0, -1), current],
    timeline: [...sop.timeline, event(sop, 'file-replaced', actorId)],
  }
}

/** Author or co-author: upload a new version after a return (PBI 8 / 12); +0.1. */
export function uploadNewVersion(sop: Sop, actorId: string, file: UploadedFile): Sop {
  assertStatus(sop, ['returned'], 'upload a new version of')
  assert(isAuthorOrCoAuthor(sop, actorId), 'Only the author or a co-author can upload a new version')
  const version = nextVersion(sop.version)
  const updated: Sop = { ...sop, ...file, version, lastUpdated: todayIsoDate() }
  return {
    ...updated,
    versions: [...sop.versions, { version, ...file, uploadedAt: new Date().toISOString() }],
    timeline: [...sop.timeline, event(updated, 'new-version-uploaded', actorId)],
  }
}

/** Main author: add a co-author (PBI 2). Not when Published; never a reviewer or approver. */
export function addCoAuthor(sop: Sop, actorId: string, userId: string): Sop {
  assert(isAuthor(sop, actorId), 'Only the author can manage co-authors')
  assert(sop.status !== 'published', "Co-authors can't change once the SOP is published")
  assert(userId !== sop.authorId && !isCoAuthor(sop, userId), 'Already an author of this SOP')
  assert(!isReviewer(sop, userId) && !isApprover(sop, userId), 'Reviewers and approvers cannot be co-authors')
  return {
    ...sop,
    coAuthorIds: [...sop.coAuthorIds, userId],
    timeline: [...sop.timeline, event(sop, 'co-author-added', actorId, { subjectId: userId })],
  }
}

/** Main author: remove a co-author (PBI 2). Not when Published. */
export function removeCoAuthor(sop: Sop, actorId: string, userId: string): Sop {
  assert(isAuthor(sop, actorId), 'Only the author can manage co-authors')
  assert(sop.status !== 'published', "Co-authors can't change once the SOP is published")
  assert(isCoAuthor(sop, userId), 'Not a co-author of this SOP')
  return {
    ...sop,
    coAuthorIds: sop.coAuthorIds.filter((id) => id !== userId),
    timeline: [...sop.timeline, event(sop, 'co-author-removed', actorId, { subjectId: userId })],
  }
}

// ---------- Reviewer and approver actions ----------

function returnToAuthors(sop: Sop, actorId: string, role: 'reviewer' | 'approver', text: string, createdAt: string): Sop {
  const comment: SopComment = { id: newId('com'), authorUserId: actorId, role, text, createdAt, version: sop.version }
  return {
    ...sop,
    status: 'returned',
    lastUpdated: todayIsoDate(),
    comments: [...sop.comments, comment],
    timeline: [...sop.timeline, { ...event(sop, 'returned', actorId, { recipientIds: authors(sop) }), createdAt }],
  }
}

/** A pending reviewer completes their review. When ALL have, the SOP moves to In Approval. */
export function completeReview(sop: Sop, reviewerId: string): Sop {
  assertStatus(sop, ['in-review'], 'complete the review of')
  assert(sop.reviewers.some((p) => p.userId === reviewerId && p.decision === 'pending'), 'Not a pending reviewer')
  const createdAt = new Date().toISOString()
  const reviewers = sop.reviewers.map((p) =>
    p.userId === reviewerId ? { ...p, decision: 'completed' as const, decidedAt: createdAt } : p,
  )
  let updated: Sop = {
    ...sop,
    reviewers,
    lastUpdated: todayIsoDate(),
    timeline: [...sop.timeline, { ...event(sop, 'review-completed', reviewerId), createdAt }],
  }
  if (reviewers.every((p) => p.decision === 'completed')) {
    // Last reviewer done: forward to the approvers automatically, and start the approval clock.
    const approvalDueAt = addDays(createdAt, sop.approvalDueDays ?? DUE_DAYS_MIN)
    updated = {
      ...updated,
      status: 'in-approval',
      approvalDueAt,
      timeline: [
        ...updated.timeline,
        { ...event(sop, 'forwarded-to-approver', SYSTEM_ACTOR, { recipientIds: sop.approvers.map((p) => p.userId) }), createdAt },
        { ...event(sop, 'stage-due-date-set', SYSTEM_ACTOR, { stage: 'approval', dueAt: approvalDueAt }), createdAt },
      ],
    }
  }
  return updated
}

/** A pending reviewer returns the SOP with a comment; it goes back to the author at once. */
export function returnAsReviewer(sop: Sop, reviewerId: string, text: string): Sop {
  assertStatus(sop, ['in-review'], 'return')
  assert(sop.reviewers.some((p) => p.userId === reviewerId && p.decision === 'pending'), 'Not a pending reviewer')
  assert(!!text.trim(), 'A comment is required')
  const createdAt = new Date().toISOString()
  const withDecision: Sop = {
    ...sop,
    reviewers: sop.reviewers.map((p) =>
      p.userId === reviewerId ? { ...p, decision: 'returned' as const, decidedAt: createdAt } : p,
    ),
  }
  return returnToAuthors(withDecision, reviewerId, 'reviewer', text.trim(), createdAt)
}

/** A pending approver approves. When ALL have, the SOP is Approved. */
export function approveAs(sop: Sop, approverId: string): Sop {
  assertStatus(sop, ['in-approval'], 'approve')
  assert(sop.approvers.some((p) => p.userId === approverId && p.decision === 'pending'), 'Not a pending approver')
  const createdAt = new Date().toISOString()
  const approvers = sop.approvers.map((p) =>
    p.userId === approverId ? { ...p, decision: 'approved' as const, decidedAt: createdAt } : p,
  )
  let updated: Sop = {
    ...sop,
    approvers,
    lastUpdated: todayIsoDate(),
    timeline: [...sop.timeline, { ...event(sop, 'approved-by', approverId), createdAt }],
  }
  if (approvers.every((p) => p.decision === 'approved')) {
    updated = {
      ...updated,
      status: 'approved',
      timeline: [...updated.timeline, { ...event(sop, 'approved', SYSTEM_ACTOR), createdAt }],
    }
  }
  return updated
}

/** A pending approver returns the SOP with a comment; it goes back to the author at once. */
export function returnAsApprover(sop: Sop, approverId: string, text: string): Sop {
  assertStatus(sop, ['in-approval'], 'return')
  assert(sop.approvers.some((p) => p.userId === approverId && p.decision === 'pending'), 'Not a pending approver')
  assert(!!text.trim(), 'A comment is required')
  const createdAt = new Date().toISOString()
  const withDecision: Sop = {
    ...sop,
    approvers: sop.approvers.map((p) =>
      p.userId === approverId ? { ...p, decision: 'returned' as const, decidedAt: createdAt } : p,
    ),
  }
  return returnToAuthors(withDecision, approverId, 'approver', text.trim(), createdAt)
}

/** Any assigned approver publishes the approved SOP; it then appears in the SOPs directory. */
export function publishAs(sop: Sop, approverId: string): Sop {
  assertStatus(sop, ['approved'], 'publish')
  assert(isApprover(sop, approverId), 'Only an assigned approver can publish')
  return {
    ...sop,
    status: 'published',
    lastUpdated: todayIsoDate(),
    timeline: [...sop.timeline, event(sop, 'published', approverId)],
  }
}

// ---------- Development only ----------

/** Moves the stored due dates `days` earlier (to test Overdue). Used by the dev-only demo panel. */
export function shiftDueDates(sop: Sop, days: number): Sop {
  return {
    ...sop,
    reviewDueAt: sop.reviewDueAt ? addDays(sop.reviewDueAt, -days) : undefined,
    approvalDueAt: sop.approvalDueAt ? addDays(sop.approvalDueAt, -days) : undefined,
  }
}
