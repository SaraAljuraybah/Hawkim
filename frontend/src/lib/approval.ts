import type { ApprovalSubmission, Department, Sop, TimelineEvent, User } from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { todayIsoDate } from './format'
import type { ReviewEnvironment } from './reviewFlow'
import { hasCompletedCurrentReview, isAuthorOrCoAuthor, isReviewer, SUBMIT_COMMENT_MAX } from './workflow'

export interface ApprovalSubmissionOptions {
  /** The version and completed round shown when the Author opened the dialog. */
  version: string
  internalReviewRoundId: string
  /** The Approver the main Author chose (one of eligibleApprovers). */
  approverId?: string
  /** Optional comment for the approver, up to SUBMIT_COMMENT_MAX characters. */
  note?: string
  /** This browser remembers sending this version for approval (approval isn't in the database yet). */
  sentBefore?: boolean
}

/** Why approval isn't available; each comes with a full sentence in `reasons` (same order). */
export type ApprovalBlocker = 'not-main-author' | 'already-requested' | 'no-completed-review' | 'version-changed' | 'no-approver' | 'approver-required' | 'approver-not-eligible' | 'note-too-long'

/** The reasons the author's page can show on the button: only one applies at a time. */
export type ApprovalButtonBlocker = Extract<ApprovalBlocker, 'already-requested' | 'no-completed-review'>

export interface ApprovalReadiness {
  ready: boolean
  /** Full sentences, used in errors. */
  reasons: string[]
  /** The same reasons as codes, for the texts in the content files. */
  blockers: ApprovalBlocker[]
  /** The chosen approver, when they are eligible. */
  approver?: User
}

/** Statuses at or after approval: the SOP was already sent. */
const APPROVAL_STAGE = new Set<SopStatus>(['in-approval', 'approved', 'published'])

let serial = 0
const id = (prefix: string) => prefix + '-' + Date.now().toString(36) + '-' + (++serial)

/**
 * Submit for approval on the author's page: available once at least one reviewer completed
 * the current version, unless the SOP was already sent. An approver is assumed to exist;
 * the submit step checks it.
 */
export function approvalButtonBlocker(sop: Sop, sentBefore = false): ApprovalButtonBlocker | undefined {
  if (sentBefore || APPROVAL_STAGE.has(sop.status)) return 'already-requested'
  if (!hasCompletedCurrentReview(sop)) return 'no-completed-review'
  return undefined
}

/** The Quality department (the one with `isQuality`), unless it was removed. */
export function qualityDepartment(departments: Department[]): Department | undefined {
  return departments.find((department) => department.isQuality && !department.removedAt)
}

/**
 * Who can approve this SOP: active people with the Approver permission in the Quality department,
 * never an admin, the main Author, a Co-Author or anyone who reviewed the SOP.
 */
export function eligibleApprovers(sop: Sop, env: ReviewEnvironment): User[] {
  const quality = qualityDepartment(env.departments)
  if (!quality) return []
  return env.users.filter((user) => user.departmentId === quality.id && !user.deletedAt && user.permissions.includes('approver') &&
    !user.permissions.includes('admin') && !isAuthorOrCoAuthor(sop, user.id) && !isReviewer(sop, user.id))
}

/**
 * Every check of the submit step: the button's rule, plus the main Author, a current dialog, an eligible
 * approver and the comment's length. Without `approverId` (the button, or before a choice) only
 * "nobody is eligible" counts.
 */
export function approvalReadiness(sop: Sop, actorId: string, env: ReviewEnvironment, options: Partial<ApprovalSubmissionOptions> = {}): ApprovalReadiness {
  const reasons: string[] = []
  const blockers: ApprovalBlocker[] = []
  const block = (code: ApprovalBlocker, reason: string) => { blockers.push(code); reasons.push(reason) }
  const actor = env.users.find((user) => user.id === actorId)
  if (actorId !== sop.authorId || !actor || actor.deletedAt || !actor.permissions.includes('author') || actor.permissions.includes('admin')) {
    block('not-main-author', 'Only the active main Author can submit this SOP for approval.')
  }
  const button = approvalButtonBlocker(sop, options.sentBefore)
  if (button === 'already-requested') block(button, 'Already sent for approval.')
  if (button === 'no-completed-review') block(button, 'At least one reviewer must complete the review of the current version first.')
  const round = sop.internalReviewRounds?.at(-1)
  if (options.version !== undefined && options.version !== sop.version || options.internalReviewRoundId !== undefined && options.internalReviewRoundId !== round?.id) {
    block('version-changed', 'The SOP version or review round has changed. Reopen Submit for approval.')
  }

  // The main Author chooses one eligible Approver of the Quality department.
  const eligible = eligibleApprovers(sop, env)
  const approver = eligible.find((user) => user.id === options.approverId)
  if (!eligible.length) block('no-approver', 'No approver is available. Contact your admin.')
  else if ('approverId' in options && !options.approverId) block('approver-required', 'Select an approver.')
  else if (options.approverId && !approver) block('approver-not-eligible', 'The chosen approver can’t approve this SOP. Choose another approver.')
  if ((options.note?.trim().length ?? 0) > SUBMIT_COMMENT_MAX) block('note-too-long', `Comments must be at most ${SUBMIT_COMMENT_MAX} characters.`)
  return { ready: reasons.length === 0, reasons, blockers, approver }
}

/** Main-Author-only handoff. It creates one real approval task; reviewer requests still open stay open. */
export function submitForApproval(sop: Sop, actorId: string, options: ApprovalSubmissionOptions, env: ReviewEnvironment): Sop {
  if (!options.version || !options.internalReviewRoundId) throw new Error('The current SOP version and internal review round are required.')
  const readiness = approvalReadiness(sop, actorId, env, { ...options, approverId: options.approverId ?? '' })
  if (!readiness.ready) throw new Error(readiness.reasons.join(' '))
  const now = new Date().toISOString()
  const submissionId = id('approval-request')
  const note = options.note?.trim() || undefined
  const submission: ApprovalSubmission = {
    id: submissionId, version: sop.version, internalReviewRoundId: options.internalReviewRoundId,
    submittedById: actorId, submittedAt: now, approverId: readiness.approver!.id,
    status: 'pending', assignedDueDays: null,
    ...(note ? { note } : {}),
  }
  const record = (type: TimelineEvent['type'], extra: Partial<TimelineEvent> = {}): TimelineEvent => ({
    id: id('approval-event'), type, actorId, version: sop.version, reviewRoundId: options.internalReviewRoundId,
    approvalSubmissionId: submissionId, createdAt: now, ...extra,
  })
  return {
    ...sop, status: 'in-approval',
    approvalSubmissions: [...(sop.approvalSubmissions ?? []), submission],
    approvers: [{ id: submissionId, version: sop.version, assignedAt: now, userId: submission.approverId, decision: 'pending' }],
    approvalDueDays: undefined, approvalDueAt: undefined,
    lastUpdated: todayIsoDate(),
    // The comment shows on the timeline, as Submit for Review's does.
    timeline: [...sop.timeline, record('submitted-for-approval', { recipientIds: [submission.approverId], ...(note ? { note } : {}) })],
  }
}
