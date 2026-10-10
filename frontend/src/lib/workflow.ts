import {
  SYSTEM_ACTOR,
  type ApproverAssignment,
  type User,
  type ReviewerAssignment,
  type Sop,
  type SopComment,
  type SopVersion,
  type TimelineEvent,
  type TimelineEventType,
} from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { hasCurrentCheck } from './compliance'
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

/** Response texts are limited like comments. */
export const RESPONSE_MAX = 1000

/** The SOP's versions that weren't deleted, oldest first. */
export function activeVersions(sop: Sop): SopVersion[] {
  return sop.versions.filter((version) => !version.deletedAt)
}

/**
 * The next version number: one more than the highest ever used (deleted versions
 * included, so a number is never reused): v1, v2, v3…
 */
export function nextVersion(sop: Pick<Sop, 'versions'>): string {
  return String(Math.max(0, ...sop.versions.map((version) => Number(version.version))) + 1)
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

/**
 * A returned SOP can be resubmitted only once its current version was uploaded AFTER
 * the latest return (PBI 6), so deleting back to an older version doesn't allow it.
 */
export function canResubmit(sop: Sop): boolean {
  if (sop.status !== 'returned') return false
  const returned = latestReturn(sop)
  const current = activeVersions(sop).find((version) => version.version === sop.version)
  return !!returned && !!current && new Date(current.uploadedAt).getTime() >= new Date(returned.createdAt).getTime()
}

/** The comment saved with a timeline event, if any (new events link it; older ones match by person and time). */
export function commentForEvent(sop: Sop, event: TimelineEvent): SopComment | undefined {
  if (event.commentId) return sop.comments.find((comment) => comment.id === event.commentId)
  if (event.type !== 'returned' && event.type !== 'review-completed' && event.type !== 'approved-by') return undefined
  return sop.comments.find((comment) => comment.authorUserId === event.actorId && comment.createdAt === event.createdAt)
}

/**
 * Who a Response goes to: everyone who commented in the latest round, i.e. since the
 * most recent submission or resubmission before the latest comment (the person who
 * returned it, plus anyone who left a comment when completing a review or approving).
 */
export function responseRecipients(sop: Sop): string[] {
  const time = (iso: string) => new Date(iso).getTime()
  const latest = [...sop.comments].sort((a, b) => time(a.createdAt) - time(b.createdAt)).at(-1)
  if (!latest) return []
  const roundStart = sop.timeline
    .filter((event) => (event.type === 'submitted' || event.type === 'resubmitted') && time(event.createdAt) <= time(latest.createdAt))
    .map((event) => time(event.createdAt))
    .reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY)
  return [...new Set(sop.comments.filter((comment) => time(comment.createdAt) >= roundStart).map((comment) => comment.authorUserId))]
}

/** Why a version can't be deleted now (undefined: it can). */
export type DeleteVersionBlocker = 'status' | 'not-main-author' | 'last-version'

export function deleteVersionBlocker(sop: Sop, actorId: string): DeleteVersionBlocker | undefined {
  if (sop.status !== 'draft' && sop.status !== 'returned') return 'status'
  if (!isAuthor(sop, actorId)) return 'not-main-author'
  if (activeVersions(sop).length <= 1) return 'last-version'
  return undefined
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

/** A stage's due date `days` after `from`, or undefined when the stage has no due days. */
function dueDateFrom(from: string, days: number | undefined): string | undefined {
  return days === undefined ? undefined : addDays(from, days)
}

/**
 * Author: first submission (PBI 6). The author picks one or more reviewers and
 * approvers, and optionally the due days per stage (PBI 3). A stage without due
 * days has no due date and is never overdue.
 */
export function submitForReview(
  sop: Sop,
  actorId: string,
  /** The current GVP version: the SOP must have a completed check against it. */
  guidelineVersion: string,
  reviewerIds: string[],
  approverIds: string[],
  reviewDueDays: number | undefined,
  approvalDueDays: number | undefined,
  note?: string,
): Sop {
  assertStatus(sop, ['draft'], 'submit')
  assert(isAuthor(sop, actorId), 'Only the author can submit this SOP')
  // The check must have run for this version against the current guideline; it doesn't have to pass (PBI 4, 29).
  assert(hasCurrentCheck(sop, guidelineVersion), 'Run a compliance check against the current guideline first')
  assertSeparation(sop, reviewerIds, approverIds)
  assert(
    [reviewDueDays, approvalDueDays].every((days) => days === undefined || isValidDueDays(days)),
    'Due days must be from 1 to 30',
  )
  const createdAt = new Date().toISOString()
  const reviewDueAt = dueDateFrom(createdAt, reviewDueDays)
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
      ...(reviewDueAt ? [{ ...event(sop, 'stage-due-date-set', actorId, { stage: 'review', dueAt: reviewDueAt }), createdAt }] : []),
    ],
  }
}

/**
 * Author: resubmit after a new version. Same reviewers, approvers and due days;
 * everyone's decision resets and it goes through review and approval again.
 */
export function resubmit(sop: Sop, actorId: string, guidelineVersion: string, note?: string): Sop {
  assert(isAuthor(sop, actorId), 'Only the author can resubmit this SOP')
  assert(canResubmit(sop), 'Upload a new version before resubmitting')
  assert(hasCurrentCheck(sop, guidelineVersion), 'Run a compliance check against the current guideline first')
  const createdAt = new Date().toISOString()
  const reviewDueAt = dueDateFrom(createdAt, sop.reviewDueDays)
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
      ...(reviewDueAt ? [{ ...event(sop, 'stage-due-date-set', actorId, { stage: 'review', dueAt: reviewDueAt }), createdAt }] : []),
    ],
  }
}

/**
 * Author or co-author: upload a file (PBI 8 / 12). Every upload adds the next version
 * (v1, v2…), which becomes current. Only while the SOP is a Draft or Returned.
 */
export function uploadVersion(sop: Sop, actorId: string, file: UploadedFile): Sop {
  assertStatus(sop, ['draft', 'returned'], 'upload a version of')
  assert(isAuthorOrCoAuthor(sop, actorId), 'Only the author or a co-author can upload a version')
  const version = nextVersion(sop)
  const uploadedAt = new Date().toISOString()
  const updated: Sop = { ...sop, ...file, version, lastUpdated: todayIsoDate() }
  return {
    ...updated,
    versions: [...sop.versions, { version, ...file, uploadedById: actorId, uploadedAt }],
    timeline: [...sop.timeline, { ...event(updated, 'version-uploaded', actorId), createdAt: uploadedAt }],
  }
}

/**
 * Main author: delete a version (Draft or Returned only; at least one must remain).
 * Deleting the current version makes the newest remaining one current. The deletion
 * is recorded in the timeline ("Deleted v2").
 */
export function deleteVersion(sop: Sop, actorId: string, version: string): Sop {
  const blocker = deleteVersionBlocker(sop, actorId)
  assert(blocker !== 'status', `Can't delete a version of an SOP that is ${sop.status}`)
  assert(blocker !== 'not-main-author', 'Only the main author can delete versions')
  assert(blocker !== 'last-version', 'At least one version must remain')
  const target = activeVersions(sop).find((item) => item.version === version)
  assert(!!target, `Unknown version ${version}`)
  const deletedAt = new Date().toISOString()
  const versions = sop.versions.map((item) => (item === target ? { ...item, deletedAt, deletedById: actorId } : item))
  let updated: Sop = { ...sop, versions, lastUpdated: todayIsoDate() }
  if (sop.version === version) {
    const remaining = versions.filter((item) => !item.deletedAt)
    const newest = remaining.reduce((a, b) => (Number(b.version) > Number(a.version) ? b : a))
    updated = {
      ...updated,
      version: newest.version,
      fileName: newest.fileName,
      fileType: newest.fileType,
      fileUrl: newest.fileUrl,
    }
  }
  return {
    ...updated,
    timeline: [...sop.timeline, { ...event(sop, 'version-deleted', actorId), version, createdAt: deletedAt }],
  }
}

/**
 * Author or co-author: reply to the reviewers' and approvers' comments. Recorded in the
 * timeline, sent to everyone who commented in the latest round (see responseRecipients).
 * Not once the SOP is published.
 */
export function addResponse(sop: Sop, actorId: string, text: string): Sop {
  assert(sop.status !== 'published', "Can't respond once the SOP is published")
  assert(isAuthorOrCoAuthor(sop, actorId), 'Only the author or a co-author can respond')
  const trimmed = text.trim()
  assert(!!trimmed && trimmed.length <= RESPONSE_MAX, 'A response of up to 1000 characters is required')
  const recipientIds = responseRecipients(sop)
  assert(recipientIds.length > 0, 'There are no comments to respond to')
  return {
    ...sop,
    lastUpdated: todayIsoDate(),
    timeline: [...sop.timeline, event(sop, 'response', actorId, { recipientIds, note: trimmed })],
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
    timeline: [
      ...sop.timeline,
      { ...event(sop, 'returned', actorId, { recipientIds: authors(sop), commentId: comment.id }), createdAt },
    ],
  }
}

/** An optional comment with a decision (Complete review, Approve): saved like any other comment. */
function optionalComment(
  sop: Sop,
  actorId: string,
  role: 'reviewer' | 'approver',
  text: string | undefined,
  createdAt: string,
): SopComment | undefined {
  const trimmed = text?.trim()
  return trimmed ? { id: newId('com'), authorUserId: actorId, role, text: trimmed, createdAt, version: sop.version } : undefined
}

/**
 * A pending reviewer completes their review (PBI 7, 9), with an optional comment.
 * When ALL reviewers have, the SOP moves to In Approval.
 */
export function completeReview(sop: Sop, reviewerId: string, text?: string): Sop {
  assertStatus(sop, ['in-review'], 'complete the review of')
  assert(sop.reviewers.some((p) => p.userId === reviewerId && p.decision === 'pending'), 'Not a pending reviewer')
  const createdAt = new Date().toISOString()
  const reviewers = sop.reviewers.map((p) =>
    p.userId === reviewerId ? { ...p, decision: 'completed' as const, decidedAt: createdAt } : p,
  )
  const comment = optionalComment(sop, reviewerId, 'reviewer', text, createdAt)
  let updated: Sop = {
    ...sop,
    reviewers,
    lastUpdated: todayIsoDate(),
    comments: comment ? [...sop.comments, comment] : sop.comments,
    timeline: [...sop.timeline, { ...event(sop, 'review-completed', reviewerId, comment ? { commentId: comment.id } : {}), createdAt }],
  }
  if (reviewers.every((p) => p.decision === 'completed')) {
    // Last reviewer done: forward to the approvers automatically, and start the approval clock (if any).
    const approvalDueAt = dueDateFrom(createdAt, sop.approvalDueDays)
    updated = {
      ...updated,
      status: 'in-approval',
      approvalDueAt,
      timeline: [
        ...updated.timeline,
        { ...event(sop, 'forwarded-to-approver', SYSTEM_ACTOR, { recipientIds: sop.approvers.map((p) => p.userId) }), createdAt },
        ...(approvalDueAt
          ? [{ ...event(sop, 'stage-due-date-set', SYSTEM_ACTOR, { stage: 'approval', dueAt: approvalDueAt }), createdAt }]
          : []),
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

/** A pending approver approves (PBI 10, 11), with an optional comment. When ALL have, the SOP is Approved. */
export function approveAs(sop: Sop, approverId: string, text?: string): Sop {
  assertStatus(sop, ['in-approval'], 'approve')
  assert(sop.approvers.some((p) => p.userId === approverId && p.decision === 'pending'), 'Not a pending approver')
  const createdAt = new Date().toISOString()
  const approvers = sop.approvers.map((p) =>
    p.userId === approverId ? { ...p, decision: 'approved' as const, decidedAt: createdAt } : p,
  )
  const comment = optionalComment(sop, approverId, 'approver', text, createdAt)
  let updated: Sop = {
    ...sop,
    approvers,
    lastUpdated: todayIsoDate(),
    comments: comment ? [...sop.comments, comment] : sop.comments,
    timeline: [...sop.timeline, { ...event(sop, 'approved-by', approverId, comment ? { commentId: comment.id } : {}), createdAt }],
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

/**
 * Whether `person` can be routed in as a reviewer (PBI 23): they have the Reviewer
 * permission, work in another department than the SOP's, and aren't already on it
 * (author, co-author, reviewer or approver: separation of duties).
 */
export function canBeRoutedTo(sop: Sop, person: Pick<User, 'id' | 'departmentId' | 'permissions' | 'deletedAt'>): boolean {
  return (
    !person.deletedAt &&
    person.permissions.includes('reviewer') &&
    person.departmentId !== sop.departmentId &&
    !isAuthorOrCoAuthor(sop, person.id) &&
    !isReviewer(sop, person.id) &&
    !isApprover(sop, person.id)
  )
}

/**
 * An assigned reviewer routes the SOP to a reviewer from another department (PBI 23).
 * Only while In Review. The new reviewer starts pending, so the SOP now also waits
 * for them; the review due date doesn't change. The routing reviewer still decides.
 */
export function routeToReviewer(
  sop: Sop,
  actorId: string,
  newReviewer: Pick<User, 'id' | 'departmentId' | 'permissions' | 'deletedAt'>,
  note?: string,
): Sop {
  assertStatus(sop, ['in-review'], 'route')
  assert(isReviewer(sop, actorId), 'Only an assigned reviewer can route this SOP')
  assert(canBeRoutedTo(sop, newReviewer), 'This person can’t be added as a reviewer')
  const trimmed = note?.trim()
  return {
    ...sop,
    reviewers: [...sop.reviewers, { userId: newReviewer.id, decision: 'pending' }],
    lastUpdated: todayIsoDate(),
    timeline: [
      ...sop.timeline,
      event(sop, 'routed', actorId, {
        recipientIds: [newReviewer.id],
        departmentId: newReviewer.departmentId,
        ...(trimmed ? { note: trimmed } : {}),
      }),
    ],
  }
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
