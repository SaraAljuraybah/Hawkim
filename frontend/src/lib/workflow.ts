import {
  SYSTEM_ACTOR,
  type ApprovalDecisionSnapshot,
  type ApprovalSubmission,
  type ApproverAssignment,
  type InternalReviewerAssignment,
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
import { isOpenDecision, latestAssignments, projectReviewers, requestDeadline } from './internalReviewStatus'

/*
 * SOP workflow rules (Sprint 0, PBI 2 / 3 / 6 / 8 / 12 / 22 / 24) as pure functions.
 * Each transition returns an updated copy of the SOP — status, people, due dates,
 * versions, comments, timeline and lastUpdated change together — or throws if the
 * action isn't allowed.
 *
 * Draft → In Review → (Returned) → In Approval → Approved → Published
 * - Reviewers work one after another, in the order they were assigned (routed reviewers
 *   join at the end): only the current reviewer (the first pending one) can complete
 *   their review, return the SOP or route it. In Approval only when ALL reviewers
 *   completed; the current reviewer's return sends the SOP back to the author at once.
 * - Approvers work in parallel: Approved only when ALL approved; ANY return → Returned.
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

/** Legacy numeric allocations and approval dates retain their existing 1–30 day range. */
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

/** `now`'s local calendar date plus `days`, as an ISO date ("2026-10-19"). */
function localDatePlus(now: Date, days: number): string {
  return todayIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days))
}

/** Review dates are optional, today or later, without an upper limit. */
export function dueDateRange(now = new Date()): { min: string; max?: string } {
  return { min: todayIsoDate(now) }
}

/** Approval-stage restrictions are independent of the review date picker. */
export function approvalDueDateRange(now = new Date()): { min: string; max: string } {
  return { min: localDatePlus(now, DUE_DAYS_MIN), max: localDatePlus(now, DUE_DAYS_MAX) }
}

/**
 * Calendar days from today to an ISO date ("2026-10-19"), or undefined if it isn't a
 * real date. Counted by date, not by hours, so a daylight-saving change doesn't matter.
 */
export function daysFromToday(isoDate: string, now = new Date()): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return undefined
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined // e.g. Feb 30
  return Math.round((date.getTime() - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS)
}

/**
 * An optional review deadline as calendar days from submission. The deadline ends at
 * 23:59:59.999 on the selected local date. Empty is valid; past/invalid dates are not.
 */
export function parseDueDate(isoDate: string, now = new Date()): { valid: boolean; days?: number } {
  if (!isoDate.trim()) return { valid: true }
  const days = daysFromToday(isoDate.trim(), now)
  return days !== undefined && days >= 0 ? { valid: true, days } : { valid: false }
}

/** Approval dates preserve their original tomorrow-through-30-days validation. */
export function parseApprovalDueDate(isoDate: string, now = new Date()): { valid: boolean; days?: number } {
  if (!isoDate.trim()) return { valid: true }
  const days = daysFromToday(isoDate.trim(), now)
  return days !== undefined && isValidDueDays(days) ? { valid: true, days } : { valid: false }
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

/** Assignment involvement, including history; use reviewSopForUser for document access. */
export function isReviewer(sop: Sop, userId: string): boolean {
  return sop.reviewers.some((person) => person.userId === userId) ||
    !!sop.internalReviewRounds?.some((round) => round.assignments.some((person) => person.userId === userId)) ||
    !!(sop.externalReviewGate?.requirement === 'required' && sop.externalReviewGate.assignments.some((person) => person.userId === userId))
}

export function isApprover(sop: Sop, userId: string): boolean {
  return sop.approvers.some((person) => person.userId === userId) ||
    !!sop.approvalSubmissions?.some((submission) => submission.approverId === userId)
}

/** Reviewers or approvers who still have to decide in the current stage. */

/** The explicit review-plan owner, or the first pending reviewer on a legacy SOP. */
export function currentReviewer(
  sop: Sop,
): ReviewerAssignment | undefined {
  if (sop.status !== 'in-review') return undefined
  if (sop.reviewFlow) return sop.reviewers.find((person) => person.userId === sop.reviewFlow!.activeReviewerId && person.decision !== 'cancelled')
  if (sop.internalReviewRounds?.length) return undefined
  return sop.reviewers.find((person) => person.decision === 'pending')
}

export function pendingPeople(
  sop: Sop,
): { userId: string; role: 'reviewer' | 'approver' }[] {
  if (sop.status === 'in-review') {
    const round = sop.internalReviewRounds?.at(-1)
    if (round && !sop.reviewFlow) return round.status === 'open' && round.version === sop.version
      ? latestAssignments(round).filter((person) => isOpenDecision(person.decision)).map((person) => ({ userId: person.userId, role: 'reviewer' as const }))
      : []
    const reviewer = currentReviewer(sop)

    return reviewer
      ? [{ userId: reviewer.userId, role: 'reviewer' }]
      : []
  }

  if (sop.status === 'in-approval') {
    return sop.approvers
      .filter((person) => person.decision === 'pending')
      .map((person) => ({
        userId: person.userId,
        role: 'approver',
      }))
  }

  return []
}


// ---------- Due dates (PBI 3) ----------

/** A legacy reviewer assignment or an internal review request: what its deadline depends on. */
export type DeadlineHolder = Pick<ReviewerAssignment, 'userId' | 'dueDate' | 'assignedDueDays'> & { assignedAt?: string } &
  Partial<Pick<InternalReviewerAssignment, 'id' | 'acceptedAt' | 'responseDueDate' | 'reviewDueDate'>>

/** Original allocation, with compatibility for date-only and shared-deadline records. */
export function reviewerAssignedDays(sop: Sop, reviewer: DeadlineHolder): number | undefined {
  if (reviewer.assignedDueDays !== undefined) return reviewer.assignedDueDays ?? undefined
  if (reviewer.dueDate) {
    const submitted = [...sop.timeline].reverse().find((item) => item.type === 'submitted' || item.type === 'resubmitted')
    const days = submitted ? daysFromToday(reviewer.dueDate, new Date(submitted.createdAt)) : undefined
    return days !== undefined && days >= 0 ? days : undefined
  }
  return sop.reviewDueDays
}

/** A reviewer's due date ("2026-10-29") as a deadline: the end of that day, local time (ISO date and time). */
export function dueAtOfDate(isoDate: string): string {
  return new Date(`${isoDate}T23:59:59.999`).toISOString()
}

/**
 * This person's deadline, including legacy shared deadlines. An explicit blank never inherits one.
 * An internal review request has its own: the response due date until accepted, then the review due date.
 */
export function reviewerDueAt(sop: Sop, reviewer: DeadlineHolder): string | undefined {
  if (sop.internalReviewRounds?.length && reviewer.id) return requestDeadline(reviewer)?.dueAt
  if (reviewer.assignedDueDays === null) return undefined
  return reviewer.dueDate ? dueAtOfDate(reviewer.dueDate) : sop.reviewDueAt
}

/** Whether this task date has passed; callers also check that the assignment is active. */
export function reviewerDeadlinePassed(sop: Sop, reviewer: DeadlineHolder, now = Date.now()): boolean {
  const dueAt = reviewerDueAt(sop, reviewer)
  return !!dueAt && new Date(dueAt).getTime() <= now
}

/** The nearest open internal request deadline, active legacy reviewer deadline, or approval deadline. */
export function currentDueAt(sop: Sop): string | undefined {
  if (sop.status === 'in-review') {
    const round = sop.internalReviewRounds?.at(-1)
    if (round && !sop.reviewFlow) {
      if (round.status !== 'open' || round.version !== sop.version) return undefined
      const open = latestAssignments(round).filter((person) => isOpenDecision(person.decision))
      return open.map((person) => requestDeadline(person)?.dueAt).filter((dueAt) => dueAt !== undefined)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
    }
    const reviewer = currentReviewer(sop)
    return reviewer ? reviewerDueAt(sop, reviewer) : undefined
  }
  return sop.status === 'in-approval' ? sop.approvalDueAt : undefined
}

/** Real elapsed time remaining, separate from the original calendar allocation. */
export function reviewerRemainingMilliseconds(sop: Sop, reviewer: DeadlineHolder, now = Date.now()): number | undefined {
  const dueAt = reviewerDueAt(sop, reviewer)
  return dueAt ? new Date(dueAt).getTime() - now : undefined
}

/** A new round's shared request deadline, measured against the actual clock. */
export function reviewRemainingMilliseconds(sop: Sop, now = Date.now()): number | undefined {
  const dueAt = currentDueAt(sop)
  return dueAt ? new Date(dueAt).getTime() - now : undefined
}

function allocationMilliseconds(assignedAt: string, days: number): number {
  const started = new Date(assignedAt)
  return new Date(dueAtOfDate(localDatePlus(started, days))).getTime() - started.getTime()
}

/** Original real time given; simulating an overdue date does not rewrite this allocation. */
export function reviewerAssignedMilliseconds(sop: Sop, reviewer: DeadlineHolder): number | undefined {
  const days = reviewerAssignedDays(sop, reviewer)
  if (days === undefined) return undefined
  if ('assignedAt' in reviewer && typeof reviewer.assignedAt === 'string') return allocationMilliseconds(reviewer.assignedAt, days)
  // Older records only kept a calendar-day allocation, so retain that original meaning.
  return days * DAY_MS
}

export function reviewAssignedMilliseconds(sop: Sop): number | undefined {
  const round = sop.internalReviewRounds?.at(-1)
  if (round) return round.assignedDueDays === null ? undefined : allocationMilliseconds(round.requestedAt, round.assignedDueDays)
  return sop.reviewDueDays === undefined ? undefined : sop.reviewDueDays * DAY_MS
}

/** Fractional 24-hour days, for legacy consumers; never a calendar-date subtraction. */
export function reviewerRemainingDays(sop: Sop, reviewer: DeadlineHolder, now = new Date()): number | undefined {
  const remaining = reviewerRemainingMilliseconds(sop, reviewer, now.getTime())
  return remaining === undefined ? undefined : remaining / DAY_MS
}

export function isOverdue(
  sop: Sop,
  stage: 'review' | 'approval',
  now = Date.now(),
): boolean {
  const open =
    stage === 'review'
      ? sop.status === 'in-review'
      : sop.status === 'in-approval'

  const dueAt =
    stage === 'review'
      ? currentDueAt(sop)
      : sop.approvalDueAt

  return open && !!dueAt && (stage === 'review' ? new Date(dueAt).getTime() <= now : new Date(dueAt).getTime() < now)
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
  const round = sop.internalReviewRounds?.at(-1)
  const approval = sop.approvalSubmissions?.at(-1)
  const approvalReturned = approval?.status === 'returned' && approval.internalReviewRoundId === round?.id && approval.version === round?.version
  if (round && ((!approvalReturned && round.status !== 'rejected') || sop.version === round.version)) return false
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
 * Who a timeline event is shown as addressed to. With `mainAuthorOnly` (the author's
 * page), a return lists only the main author, not the co-authors it was also sent to.
 * Display only: the event's recipients (and so notifications) don't change.
 */
export function timelineRecipients(sop: Sop, event: TimelineEvent, mainAuthorOnly = false): string[] {
  const recipients = event.recipientIds ?? []
  if (!mainAuthorOnly || event.type !== 'returned') return recipients
  return recipients.filter((id) => id === sop.authorId)
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

/** Who uploaded a version (a version without a recorded uploader counts as the main author's). */
export function uploaderOf(sop: Sop, version: SopVersion): string | undefined {
  return version.uploadedById ?? sop.authorId
}

/** Whether the user is the main author or uploaded this version. */
function isAuthorOrUploader(sop: Sop, userId: string, version: SopVersion | undefined): boolean {
  return isAuthor(sop, userId) || (!!version && uploaderOf(sop, version) === userId)
}

/** Why a version can't be deleted now (undefined: it can). */
export type DeleteVersionBlocker = 'status' | 'not-uploader' | 'submitted-version' | 'last-version'

/**
 * Delete a version: only while Draft or Returned (for everyone); by the main author
 * (any eligible version) or the person who uploaded it; at least one version must remain.
 * A version recorded in any submission or resubmission is permanently protected.
 */
export function deleteVersionBlocker(sop: Sop, actorId: string, version: string): DeleteVersionBlocker | undefined {
  if (sop.status !== 'draft' && sop.status !== 'returned') return 'status'
  const target = activeVersions(sop).find((item) => item.version === version)
  if (!isAuthorOrUploader(sop, actorId, target)) return 'not-uploader'
  if (sop.timeline.some((item) =>
    item.version === version && (item.type === 'submitted' || item.type === 'resubmitted'),
  )) return 'submitted-version'
  if (activeVersions(sop).length <= 1) return 'last-version'
  return undefined
}

/** Why the user can't run a compliance check now (undefined: they can). */
export type CheckBlocker = 'status' | 'not-uploader'

/**
 * Run a compliance check (of the current version): only while Draft or Returned (for
 * everyone; this wins over the next rule), by the main author or a co-author who
 * uploaded the current version. The rules for a running check are in lib/compliance.ts.
 */
export function checkBlocker(sop: Sop, actorId: string): CheckBlocker | undefined {
  if (sop.status !== 'draft' && sop.status !== 'returned') return 'status'
  const current = activeVersions(sop).find((item) => item.version === sop.version)
  if (!isAuthorOrUploader(sop, actorId, current)) return 'not-uploader'
  return undefined
}

/** Refuses a manual compliance check the user isn't allowed to run (see checkBlocker). */
export function assertCanRunCheck(sop: Sop, actorId: string): Sop {
  const blocker = checkBlocker(sop, actorId)
  assert(blocker !== 'status', `Can't run a compliance check of an SOP that is ${sop.status}`)
  assert(blocker !== 'not-uploader', 'Only the main author or the uploader of the current version can run a check')
  return sop
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
 * Legacy submission adapter for existing records/tests. New submissions use lib/reviewFlow.ts.
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
  reviewerDueDates?: Record<string, string>,
): Sop {
  assert(!sop.internalReviewRounds?.length, 'Use the internal review request to submit this SOP')
  assertStatus(sop, ['draft'], 'submit')
  assert(isAuthor(sop, actorId), 'Only the author can submit this SOP')
  // The check must have run for this version against the current guideline; it doesn't have to pass (PBI 4, 29).
  assert(hasCurrentCheck(sop, guidelineVersion), 'Run a compliance check against the current guideline first')
  assertSeparation(sop, reviewerIds, approverIds)
  assert(
    [reviewDueDays, approvalDueDays].every((days) => days === undefined || isValidDueDays(days)),
    'Due days must be from 1 to 30',
  )

  const dates = reviewerDueDates ?? {}
  const submittedAt = new Date()

  assert(
    Object.entries(dates).every(
      ([reviewerId, date]) =>
        reviewerIds.includes(reviewerId) &&
        !!date.trim() &&
        parseDueDate(date, submittedAt).valid,
    ),
    'Invalid reviewer due date',
  )

  const createdAt = submittedAt.toISOString()
  const reviewDueAt = dueDateFrom(createdAt, reviewDueDays)

  return {
    ...sop,
    status: 'in-review',

    reviewers: reviewerIds.map((userId): ReviewerAssignment => ({
      userId,
      decision: 'pending',
      ...(dates[userId] ? { dueDate: dates[userId].trim() } : {}),
      assignedDueDays: reviewerDueDates !== undefined
        ? (dates[userId] ? parseDueDate(dates[userId], submittedAt).days! : null)
        : reviewDueDays ?? null,
    })),

    approvers: approverIds.map((userId): ApproverAssignment => ({ userId, decision: 'pending' })),
    reviewDueDays,
    approvalDueDays,
    reviewDueAt,
    approvalDueAt: undefined,
    lastUpdated: todayIsoDate(),
    timeline: [
      ...sop.timeline,
      { ...event(sop, 'submitted', actorId, { recipientIds: reviewerIds.slice(0, 1), ...(note ? { note } : {}) }), createdAt },
      ...(reviewDueAt ? [{ ...event(sop, 'stage-due-date-set', actorId, { stage: 'review', dueAt: reviewDueAt }), createdAt }] : []),
    ],
  }
}

/** Submission and resubmission comments are limited to 500 characters. */
export const SUBMIT_COMMENT_MAX = 500

/**
 * Author: resubmit after a new version. It goes back to the same Reviewer 1 (and the same
 * saved review steps); everyone's decision resets. Deadlines work like the first
 * submission: every earlier deadline is cleared, Reviewer 1 gets only the optional new
 * `dueDate` (today or later), and each reviewer sets the next reviewer's due
 * date when they forward it. Original durations are never reused.
 */
export function resubmit(sop: Sop, actorId: string, guidelineVersion: string, note?: string, dueDate?: string): Sop {
  assert(!sop.internalReviewRounds?.length, 'Use the internal review request to resubmit this SOP')
  assert(isAuthor(sop, actorId), 'Only the author can resubmit this SOP')
  assert(canResubmit(sop), 'Upload a new version before resubmitting')
  assert(hasCurrentCheck(sop, guidelineVersion), 'Run a compliance check against the current guideline first')
  const trimmed = note?.trim()
  assert(!trimmed || trimmed.length <= SUBMIT_COMMENT_MAX, 'Submission comments must be at most 500 characters')
  const date = dueDate?.trim()
  const parsed = parseDueDate(date ?? '')
  assert(parsed.valid, 'Choose an optional review deadline today or later')
  const createdAt = new Date().toISOString()

  const reviewerIds = sop.reviewers.map((p) => p.userId)
  // Reviewer 1: the saved one in the review flow, or the first reviewer on older SOPs.
  const firstReviewerId = sop.reviewFlow?.reviewer1Id ?? reviewerIds[0]

  const reviewers: ReviewerAssignment[] = sop.reviewers.map((person) => ({
    userId: person.userId,
    decision: 'pending',
    ...(person.userId === firstReviewerId && date
      ? { dueDate: date, assignedDueDays: parsed.days }
      : { assignedDueDays: null }),
  }))

  return {
    ...sop,
    status: 'in-review',
    reviewers,
    approvers: sop.reviewFlow ? [] : sop.approvers.map((p) => ({ userId: p.userId, decision: 'pending' })),
    ...(sop.reviewFlow ? { reviewFlow: {
      ...sop.reviewFlow, stage: 'reviewer-1' as const, activeReviewerId: sop.reviewFlow.reviewer1Id,
      sameDivision: sop.reviewFlow.sameDivision === 'required' ? 'required' as const : 'pending' as const,
      crossDivision: sop.reviewFlow.crossDivision === 'required' ? 'required' as const : 'pending' as const,
      qualityControllerId: undefined, departments: sop.reviewFlow.departments.map((d) => ({ ...d, completed: false })),
    } } : {}),
    reviewDueDays: undefined,
    approvalDueDays: undefined,
    reviewDueAt: undefined,
    approvalDueAt: undefined,
    lastUpdated: todayIsoDate(),
    timeline: [
      ...sop.timeline,
      { ...event(sop, 'resubmitted', actorId, { recipientIds: firstReviewerId ? [firstReviewerId] : [], ...(trimmed ? { note: trimmed } : {}) }), createdAt },
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
 * Main author (any eligible version) or the person who uploaded it: delete an unsubmitted version (Draft or
 * Returned only; at least one must remain). Deleting the current version makes the
 * newest remaining one current. The deletion is recorded in the timeline ("Deleted v2").
 */
export function deleteVersion(sop: Sop, actorId: string, version: string): Sop {
  const target = activeVersions(sop).find((item) => item.version === version)
  assert(!!target, `Unknown version ${version}`)
  const blocker = deleteVersionBlocker(sop, actorId, version)
  assert(blocker !== 'status', `Can't delete a version of an SOP that is ${sop.status}`)
  assert(blocker !== 'not-uploader', 'Only the main author or the person who uploaded this version can delete it')
  assert(blocker !== 'submitted-version', 'Versions previously submitted or resubmitted for review cannot be deleted')
  assert(blocker !== 'last-version', 'At least one version must remain')
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

/**
 * Main author: add several co-authors in one update (the Add co-authors dialog). Each
 * follows addCoAuthor's rules; if one can't be added, none are.
 */
export function addCoAuthors(sop: Sop, actorId: string, userIds: string[]): Sop {
  return userIds.reduce((next, coAuthorId) => addCoAuthor(next, actorId, coAuthorId), sop)
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

function returnToAuthors(sop: Sop, actorId: string, role: 'reviewer' | 'approver', text: string, createdAt: string, submission?: ApprovalSubmission): Sop {
  const comment: SopComment = { id: newId('com'), authorUserId: actorId, role, text, createdAt, version: sop.version }
  return {
    ...sop,
    status: 'returned',
    lastUpdated: todayIsoDate(),
    comments: [...sop.comments, comment],
    timeline: [
      ...sop.timeline,
      { ...event(sop, 'returned', actorId, { recipientIds: authors(sop), commentId: comment.id,
        ...(submission ? { approvalSubmissionId: submission.id, reviewRoundId: submission.internalReviewRoundId } : {}) }), createdAt },
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
  assert(!sop.internalReviewRounds?.length, 'Use the internal review assignment to decide')
  assert(!sop.reviewFlow, 'Use the current review step to complete or forward this review')
  assertStatus(sop, ['in-review'], 'complete the review of')
  assert(
    currentReviewer(sop)?.userId === reviewerId,
    'Only the current reviewer can act',
  )
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
    timeline: [...sop.timeline, {
      ...event(sop, 'review-completed', reviewerId, {
        recipientIds: reviewers.filter((person) => person.decision === 'pending').slice(0, 1).map((person) => person.userId),
        ...(comment ? { commentId: comment.id } : {}),
      }),
      createdAt,
    }],
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

/** The current reviewer returns the SOP with a comment; it goes back to the author at once. */
export function returnAsReviewer(sop: Sop, reviewerId: string, text: string): Sop {
  assert(!sop.internalReviewRounds?.length, 'Use the internal review assignment to reject')
  assertStatus(sop, ['in-review'], 'return')
  assert(
    currentReviewer(sop)?.userId === reviewerId,
    'Only the current reviewer can act',
  )
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

/** Internal completion alone is the boundary for the next Author-controlled action. */
export function internalReviewsComplete(sop: Sop): boolean {
  const round = sop.internalReviewRounds?.at(-1)
  const latest = round ? latestAssignments(round) : []
  return !!round && round.version === sop.version && round.status === 'completed' &&
    latest.some((person) => person.decision === 'completed') &&
    latest.every((person) => person.decision === 'completed' || person.decision === 'declined' || person.decision === 'cancelled' && person.cancellationReason === 'author-cancelled')
}

/** All required initial and department reviews must be evidenced by completed assignments. */
export function requiredReviewsComplete(sop: Sop): boolean {
  const round = sop.internalReviewRounds?.at(-1)
  if (round) {
    if (!internalReviewsComplete(sop)) return false
    const waived = (person: ReviewerAssignment) => round.assignments.some((assignment) =>
      'id' in person && person.id === assignment.id && (assignment.decision === 'declined' || assignment.decision === 'cancelled' && assignment.cancellationReason === 'author-cancelled'))
    if (!sop.reviewers.every((person) => person.decision === 'completed' || person.decision === 'cancelled' && waived(person))) return false
  }
  const flow = sop.reviewFlow
  if (!flow) return !!round || sop.reviewers.every((p) => p.decision === 'completed')
  const completed = (id: string | undefined) => !!id && sop.reviewers.some((p) => p.userId === id && p.decision === 'completed')
  return completed(flow.reviewer1Id) && completed(flow.reviewer2Id) &&
    flow.sameDivision !== 'pending' && flow.crossDivision !== 'pending' &&
    (flow.sameDivision !== 'required' || flow.departments.some((d) => d.scope === 'same-division')) &&
    (flow.crossDivision !== 'required' || flow.departments.some((d) => d.scope === 'cross-division')) &&
    flow.departments.every((d) => d.completed && completed(d.representativeId) && completed(d.reviewerId))
}

/** Explicit external-review evidence only; an absent routing plan never means no reviews are required. */
export function externalReviewsComplete(sop: Sop): boolean {
  const gate = sop.externalReviewGate
  const round = sop.internalReviewRounds?.at(-1)
  if (!gate || gate.version !== sop.version || gate.internalReviewRoundId !== round?.id) return false
  if (gate.requirement === 'not-required') return gate.confirmedById === sop.authorId && !!gate.confirmedAt
  return gate.departmentIds.length > 0 && new Set(gate.departmentIds).size === gate.departmentIds.length &&
    !gate.departmentIds.includes(sop.departmentId) && gate.assignments.length === gate.departmentIds.length &&
    new Set(gate.assignments.map((assignment) => assignment.id)).size === gate.assignments.length &&
    gate.departmentIds.every((departmentId) => gate.assignments.filter((assignment) => assignment.departmentId === departmentId).length === 1) &&
    gate.assignments.every((assignment) => assignment.version === sop.version && assignment.decision === 'completed' &&
      (!assignment.feedbackRequired || assignment.feedbackAddressed === true))
}

/** Review-plan readiness also protects direct approval and publication calls. */
function assertQualityReady(sop: Sop, userId: string) {
  if (!sop.reviewFlow) return
  assert(sop.reviewFlow.stage === 'quality-approval' && sop.reviewFlow.qualityControllerId === userId && requiredReviewsComplete(sop),
    'All required reviews and the assigned Quality Document Controller are required')
}

/** A current Author-controlled approval phase, independent of retained internal review history. */
export function activeApprovalSubmission(sop: Sop): ApprovalSubmission | undefined {
  const submission = sop.approvalSubmissions?.at(-1)
  const round = sop.internalReviewRounds?.at(-1)
  if (!submission || submission.version !== sop.version || submission.internalReviewRoundId !== round?.id ||
    !internalReviewsComplete(sop) || !requiredReviewsComplete(sop) || !externalReviewsComplete(sop) ||
    sop.approvers.length !== 1 || sop.approvers[0].userId !== submission.approverId ||
    sop.approvers[0].id !== submission.id || sop.approvers[0].version !== submission.version) return undefined
  const expected = sop.status === 'in-approval' ? 'pending' : sop.status === 'approved' ? 'approved' : sop.status === 'published' ? 'published' : undefined
  if (submission.status !== expected || sop.approvers[0].decision !== (expected === 'pending' ? 'pending' : 'approved')) return undefined
  return submission
}

/** Modern requests require the exact request/version captured by the acting Approver's page. */
function assertApprovalSnapshot(sop: Sop, approverId: string, snapshot?: ApprovalDecisionSnapshot): ApprovalSubmission | undefined {
  if (!sop.internalReviewRounds?.length && !sop.approvalSubmissions?.length) return undefined
  const submission = activeApprovalSubmission(sop)
  assert(!!submission && submission.approverId === approverId && snapshot?.version === sop.version && snapshot.approvalSubmissionId === submission.id,
    'Internal review requires a current Author-controlled approval request; this request is stale, unavailable, or assigned to another Approver')
  assert(!isAuthorOrCoAuthor(sop, approverId) && !isReviewer(sop, approverId), 'Authors and Reviewers cannot approve the same SOP')
  return submission
}

function updateApprovalSubmission(sop: Sop, submission: ApprovalSubmission | undefined, status: ApprovalSubmission['status'], decidedAt: string, commentId?: string): Pick<Sop, 'approvalSubmissions'> {
  return submission ? { approvalSubmissions: sop.approvalSubmissions!.map((item) => item.id === submission.id ? {
    ...item, status, ...(status !== 'published' ? { decidedAt } : {}), ...(commentId ? { commentId } : {}),
  } : item) } : {}
}

/** A pending approver approves (PBI 10, 11), with an optional comment. When ALL have, the SOP is Approved. */
export function approveAs(sop: Sop, approverId: string, text?: string, snapshot?: ApprovalDecisionSnapshot): Sop {
  assertStatus(sop, ['in-approval'], 'approve')
  const submission = assertApprovalSnapshot(sop, approverId, snapshot)
  assertQualityReady(sop, approverId)
  assert(sop.approvers.some((p) => p.userId === approverId && p.decision === 'pending'), 'Not a pending approver')
  const createdAt = new Date().toISOString()
  const approvers = sop.approvers.map((p) =>
    p.userId === approverId ? { ...p, decision: 'approved' as const, decidedAt: createdAt } : p,
  )
  const comment = optionalComment(sop, approverId, 'approver', text, createdAt)
  let updated: Sop = {
    ...sop,
    ...updateApprovalSubmission(sop, submission, 'approved', createdAt, comment?.id),
    approvers,
    lastUpdated: todayIsoDate(),
    comments: comment ? [...sop.comments, comment] : sop.comments,
    timeline: [...sop.timeline, { ...event(sop, 'approved-by', approverId, {
      ...(comment ? { commentId: comment.id } : {}), ...(submission ? { approvalSubmissionId: submission.id, reviewRoundId: submission.internalReviewRoundId } : {}),
    }), createdAt }],
  }
  if (approvers.every((p) => p.decision === 'approved')) {
    updated = {
      ...updated,
      status: 'approved',
      timeline: [...updated.timeline, { ...event(sop, 'approved', SYSTEM_ACTOR, submission ? { approvalSubmissionId: submission.id, reviewRoundId: submission.internalReviewRoundId } : {}), createdAt }],
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
 * The current reviewer routes the SOP to a reviewer from another department (PBI 23).
 * Only while In Review. The new reviewer starts pending, so the SOP now also waits
 * for them. Routing appends to the queue without a deadline; the current reviewer still decides.
 */
export function routeToReviewer(
  sop: Sop,
  actorId: string,
  newReviewer: Pick<User, 'id' | 'departmentId' | 'permissions' | 'deletedAt'>,
  note?: string,
): Sop {
  assert(!sop.internalReviewRounds?.length, 'Internal review cannot route to external departments')
  assert(!sop.reviewFlow, 'Use the current review step to select a department and representative')
  assertStatus(sop, ['in-review'], 'route')
  assert(
    currentReviewer(sop)?.userId === actorId,
    'Only the current reviewer can route this SOP',
  )
  assert(canBeRoutedTo(sop, newReviewer), 'This person can’t be added as a reviewer')
  const trimmed = note?.trim()
  return {
    ...sop,
    reviewers: [...sop.reviewers, { userId: newReviewer.id, decision: 'pending', assignedDueDays: null }],
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
export function returnAsApprover(sop: Sop, approverId: string, text: string, snapshot?: ApprovalDecisionSnapshot): Sop {
  assertStatus(sop, ['in-approval'], 'return')
  const submission = assertApprovalSnapshot(sop, approverId, snapshot)
  assertQualityReady(sop, approverId)
  assert(sop.approvers.some((p) => p.userId === approverId && p.decision === 'pending'), 'Not a pending approver')
  assert(!!text.trim(), 'A comment is required')
  assert(!submission || text.trim().length <= RESPONSE_MAX, 'A comment of up to 1000 characters is required')
  const createdAt = new Date().toISOString()
  const withDecision: Sop = {
    ...sop,
    approvers: sop.approvers.map((p) =>
      p.userId === approverId ? { ...p, decision: 'returned' as const, decidedAt: createdAt } : p,
    ),
  }
  const returned = returnToAuthors(withDecision, approverId, 'approver', text.trim(), createdAt, submission)
  return { ...returned, ...updateApprovalSubmission(returned, submission, 'returned', createdAt, returned.comments.at(-1)?.id) }
}

/** Any assigned approver publishes the approved SOP; it then appears in the SOPs directory. */
export function publishAs(sop: Sop, approverId: string, snapshot?: ApprovalDecisionSnapshot): Sop {
  assertStatus(sop, ['approved'], 'publish')
  const submission = assertApprovalSnapshot(sop, approverId, snapshot)
  assertQualityReady(sop, approverId)
  assert(!sop.reviewFlow || sop.approvers.every((p) => p.decision === 'approved'), 'Final Quality approval is required before publication')
  assert(isApprover(sop, approverId), 'Only an assigned approver can publish')
  return {
    ...sop,
    ...updateApprovalSubmission(sop, submission, 'published', new Date().toISOString()),
    status: 'published',
    lastUpdated: todayIsoDate(),
    timeline: [...sop.timeline, event(sop, 'published', approverId, submission ? { approvalSubmissionId: submission.id, reviewRoundId: submission.internalReviewRoundId } : {})],
  }
}

// ---------- Development only ----------

/** Moves the stored due dates `days` earlier (to test Overdue). Used by the dev-only demo panel. */
export function shiftDueDates(sop: Sop, days: number): Sop {
  const approval = activeApprovalSubmission(sop)
  if (approval && sop.status === 'in-approval') return {
    ...sop,
    approvalDueAt: sop.approvalDueAt ? addDays(sop.approvalDueAt, -days) : undefined,
    approvalSubmissions: sop.approvalSubmissions!.map((submission) => submission.id === approval.id && submission.dueDate
      ? { ...submission, dueDate: localDatePlus(new Date(submission.dueDate + 'T12:00:00'), -days) } : submission),
  }
  const round = sop.internalReviewRounds?.at(-1)
  if (round) {
    if (round.status !== 'open') return sop
    // Each open request's own deadlines move; acceptance times and durations stay as they were.
    const earlier = (isoDate: string | undefined) => isoDate ? localDatePlus(new Date(isoDate + 'T12:00:00'), -days) : undefined
    const shifted = {
      ...round,
      assignments: round.assignments.map((person) => isOpenDecision(person.decision)
        ? { ...person, ...(person.responseDueDate ? { responseDueDate: earlier(person.responseDueDate) } : {}), ...(person.reviewDueDate ? { reviewDueDate: earlier(person.reviewDueDate) } : {}) }
        : person),
    }
    return { ...sop, internalReviewRounds: [...sop.internalReviewRounds!.slice(0, -1), shifted], reviewers: projectReviewers(shifted) }
  }
  return {
    ...sop,
    reviewers: sop.reviewers.map((reviewer) => ({
      ...reviewer,
      assignedDueDays: reviewerAssignedDays(sop, reviewer) ?? null,
      ...(reviewer.dueDate ? { dueDate: localDatePlus(new Date(`${reviewer.dueDate}T12:00:00`), -days) } : {}),
    })),
    reviewDueAt: sop.reviewDueAt ? addDays(sop.reviewDueAt, -days) : undefined,
    approvalDueAt: sop.approvalDueAt ? addDays(sop.approvalDueAt, -days) : undefined,
  }
}
