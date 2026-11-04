import type { ApprovalSubmission, Sop, TimelineEvent, User } from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { todayIsoDate } from './format'
import type { ReviewEnvironment } from './reviewFlow'
import { hasCompletedCurrentReview, isAuthorOrCoAuthor, isReviewer, parseApprovalDueDate } from './workflow'

export interface ApprovalSubmissionOptions {
  /** The version and completed round shown when the Author opened the dialog. */
  version: string
  internalReviewRoundId: string
  dueDate?: string
  /** This browser remembers sending this version for approval (approval isn't in the database yet). */
  sentBefore?: boolean
}

/** Why approval isn't available; each comes with a full sentence in `reasons` (same order). */
export type ApprovalBlocker = 'not-main-author' | 'already-requested' | 'no-completed-review' | 'version-changed' | 'no-approver' | 'due-date'

/** The reasons the author's page can show on the button: only one applies at a time. */
export type ApprovalButtonBlocker = Extract<ApprovalBlocker, 'already-requested' | 'no-completed-review'>

export interface ApprovalReadiness {
  ready: boolean
  /** Full sentences, used in errors. */
  reasons: string[]
  /** The same reasons as codes, for the texts in the content files. */
  blockers: ApprovalBlocker[]
  qualityController?: User
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

/** Every check of the submit step: the button's rule, plus the main Author, a current dialog, an approver and a valid deadline. */
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

  // The originating department's Quality Document Controller approves; never an author or reviewer of this SOP.
  const department = env.departments.find((item) => item.id === sop.departmentId && !item.removedAt)
  const configured = env.users.find((user) => user.id === department?.qualityControllerId)
  const qualityController = configured && !configured.deletedAt && configured.permissions.includes('approver') &&
    !configured.permissions.includes('admin') && !isAuthorOrCoAuthor(sop, configured.id) && !isReviewer(sop, configured.id) ? configured : undefined
  if (!qualityController) block('no-approver', 'No approver is available. Contact your admin.')
  if (!parseApprovalDueDate(options.dueDate ?? '').valid) block('due-date', 'Choose an optional approval deadline from tomorrow through 30 days from today.')
  return { ready: reasons.length === 0, reasons, blockers, qualityController }
}

/** Main-Author-only handoff. It creates one real approval task; reviewer requests still open stay open. */
export function submitForApproval(sop: Sop, actorId: string, options: ApprovalSubmissionOptions, env: ReviewEnvironment): Sop {
  if (!options.version || !options.internalReviewRoundId) throw new Error('The current SOP version and internal review round are required.')
  const readiness = approvalReadiness(sop, actorId, env, options)
  if (!readiness.ready) throw new Error(readiness.reasons.join(' '))
  const now = new Date().toISOString()
  const submissionId = id('approval-request')
  const dueDate = options.dueDate?.trim() || undefined
  const submission: ApprovalSubmission = {
    id: submissionId, version: sop.version, internalReviewRoundId: options.internalReviewRoundId,
    submittedById: actorId, submittedAt: now, approverId: readiness.qualityController!.id,
    status: 'pending', assignedDueDays: parseApprovalDueDate(dueDate ?? '').days ?? null,
    ...(dueDate ? { dueDate } : {}),
  }
  const record = (type: TimelineEvent['type'], extra: Partial<TimelineEvent> = {}): TimelineEvent => ({
    id: id('approval-event'), type, actorId, version: sop.version, reviewRoundId: options.internalReviewRoundId,
    approvalSubmissionId: submissionId, createdAt: now, ...extra,
  })
  const approvalDueAt = dueDate ? new Date(dueDate + 'T23:59:59.999').toISOString() : undefined
  return {
    ...sop, status: 'in-approval',
    approvalSubmissions: [...(sop.approvalSubmissions ?? []), submission],
    approvers: [{ id: submissionId, version: sop.version, assignedAt: now, userId: submission.approverId, decision: 'pending' }],
    approvalDueDays: submission.assignedDueDays ?? undefined, approvalDueAt,
    lastUpdated: todayIsoDate(),
    timeline: [...sop.timeline,
      record('submitted-for-approval', { recipientIds: [submission.approverId] }),
      ...(approvalDueAt ? [record('stage-due-date-set', { stage: 'approval', dueAt: approvalDueAt })] : []),
    ],
  }
}
