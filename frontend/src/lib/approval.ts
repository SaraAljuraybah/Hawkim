import type { ApprovalSubmission, ExternalReviewGate, Sop, TimelineEvent, User } from '../data/mock/types'
import { currentCheck } from './compliance'
import { todayIsoDate } from './format'
import type { ReviewEnvironment } from './reviewFlow'
import { externalReviewsComplete, internalReviewsComplete, isAuthorOrCoAuthor, isReviewer, parseDueDate, requiredReviewsComplete } from './workflow'

export interface ApprovalSubmissionOptions {
  /** The version and completed round shown when the Author opened the dialog. */
  version: string
  internalReviewRoundId: string
  noExternalReviewsRequired?: boolean
  feedbackAddressed?: boolean
  dueDate?: string
}

export interface ApprovalReadiness {
  ready: boolean
  reasons: string[]
  qualityController?: User
  requiresExternalConfirmation: boolean
  requiresFeedbackConfirmation: boolean
}

let serial = 0
const id = (prefix: string) => prefix + '-' + Date.now().toString(36) + '-' + (++serial)

/** Reused by the Author interface and the transition; missing assignments never imply readiness. */
export function approvalReadiness(sop: Sop, actorId: string, env: ReviewEnvironment, options: Partial<ApprovalSubmissionOptions> = {}): ApprovalReadiness {
  const reasons: string[] = []
  const actor = env.users.find((user) => user.id === actorId)
  if (actorId !== sop.authorId || !actor || actor.deletedAt || !actor.permissions.includes('author') || actor.permissions.includes('admin')) {
    reasons.push('Only the active main Author can submit this SOP for approval.')
  }
  const department = env.departments.find((item) => item.id === sop.departmentId && !item.removedAt)
  if (!department) reasons.push('The SOP department is unavailable.')
  if (sop.status !== 'in-review' || sop.reviewFlow) reasons.push('Submit for approval is available after the internal parallel review stage.')
  const round = sop.internalReviewRounds?.at(-1)
  if (!internalReviewsComplete(sop) || !requiredReviewsComplete(sop)) {
    reasons.push('Complete at least one required internal review and all remaining required reviews for the current version. Returned or cancelled rounds are not complete.')
  }
  if (options.version !== undefined && options.version !== sop.version || options.internalReviewRoundId !== undefined && options.internalReviewRoundId !== round?.id) {
    reasons.push('The SOP version or review round has changed. Reopen Submit for Approval.')
  }
  if (sop.approvalSubmissions?.some((submission) => submission.version === sop.version && submission.internalReviewRoundId === round?.id) || sop.approvers.length) {
    reasons.push('This review round already has an approval request.')
  }
  const currentVersion = sop.versions.find((version) => version.version === sop.version && !version.deletedAt)
  if (!currentVersion || currentCheck(sop)?.status !== 'completed') {
    reasons.push('Complete the compliance check for the current SOP version before approval.')
  }

  const gate = sop.externalReviewGate
  const gateIsCurrent = gate?.version === sop.version && gate.internalReviewRoundId === round?.id
  const requiresExternalConfirmation = gate?.requirement !== 'required' && !(gateIsCurrent && externalReviewsComplete(sop))
  if (gate?.requirement === 'required') {
    if (!gateIsCurrent || !externalReviewsComplete(sop)) {
      reasons.push('Complete every required external department review for the current version and review round, including returned reviews and required feedback.')
    } else {
      const eligible = gate.assignments.every((assignment) => {
        const user = env.users.find((person) => person.id === assignment.userId)
        return !!user && !user.deletedAt && !user.permissions.includes('admin') && user.permissions.includes('reviewer') &&
          user.departmentId === assignment.departmentId && !isAuthorOrCoAuthor(sop, user.id) &&
          env.departments.some((item) => item.id === assignment.departmentId && !item.removedAt)
      })
      if (!eligible) reasons.push('A required external review has no eligible independent Reviewer in its department.')
    }
  } else if (requiresExternalConfirmation && options.noExternalReviewsRequired !== true) {
    reasons.push('Confirm that no external department reviews are required before submitting for approval.')
  }

  const requiresFeedbackConfirmation = !!round?.assignments.some((assignment) => assignment.decision === 'completed' &&
    sop.comments.some((comment) => comment.reviewRoundId === round.id && comment.version === sop.version &&
      (comment.id === assignment.commentId || comment.reviewAssignmentId === assignment.id) && !!comment.text.trim()))
  if (requiresFeedbackConfirmation && options.feedbackAddressed !== true) {
    reasons.push('Confirm that the feedback from completed internal reviews has been addressed.')
  }

  const configured = env.users.find((user) => user.id === department?.qualityControllerId)
  const qualityController = configured && !configured.deletedAt && configured.permissions.includes('approver') &&
    !configured.permissions.includes('admin') && !isAuthorOrCoAuthor(sop, configured.id) && !isReviewer(sop, configured.id) &&
    !(gate?.requirement === 'required' && gate.assignments.some((assignment) => assignment.userId === configured.id)) ? configured : undefined
  if (!qualityController) reasons.push('Configure an active eligible Quality Document Controller with Approver permission for the originating department. Authors, co-authors and Reviewers cannot approve this SOP.')
  if (!parseDueDate(options.dueDate ?? '').valid) reasons.push('Choose an optional approval deadline from tomorrow through 30 days from today.')
  return { ready: reasons.length === 0, reasons, qualityController, requiresExternalConfirmation, requiresFeedbackConfirmation }
}

/** Main-Author-only handoff. It creates one real approval task and never routes external reviews. */
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
    status: 'pending', assignedDueDays: parseDueDate(dueDate ?? '').days ?? null,
    ...(dueDate ? { dueDate } : {}), ...(readiness.requiresFeedbackConfirmation ? { feedbackAddressed: true } : {}),
  }
  const record = (type: TimelineEvent['type'], extra: Partial<TimelineEvent> = {}): TimelineEvent => ({
    id: id('approval-event'), type, actorId, version: sop.version, reviewRoundId: options.internalReviewRoundId,
    approvalSubmissionId: submissionId, createdAt: now, ...extra,
  })
  const externalReviewGate: ExternalReviewGate = readiness.requiresExternalConfirmation ? {
    version: sop.version, internalReviewRoundId: options.internalReviewRoundId, requirement: 'not-required', confirmedById: actorId, confirmedAt: now,
  } : sop.externalReviewGate!
  const approvalDueAt = dueDate ? new Date(dueDate + 'T23:59:59.999').toISOString() : undefined
  return {
    ...sop, status: 'in-approval', externalReviewGate,
    approvalSubmissions: [...(sop.approvalSubmissions ?? []), submission],
    approvers: [{ id: submissionId, version: sop.version, assignedAt: now, userId: submission.approverId, decision: 'pending' }],
    approvalDueDays: submission.assignedDueDays ?? undefined, approvalDueAt,
    lastUpdated: todayIsoDate(),
    timeline: [...sop.timeline,
      ...(readiness.requiresExternalConfirmation ? [record('external-reviews-not-required', { note: 'The main Author confirmed that no external department reviews are required.' })] : []),
      record('submitted-for-approval', { recipientIds: [submission.approverId], ...(readiness.requiresFeedbackConfirmation ? { note: 'The main Author confirmed that feedback from the completed internal reviews has been addressed.' } : {}) }),
      ...(approvalDueAt ? [record('stage-due-date-set', { stage: 'approval', dueAt: approvalDueAt })] : []),
    ],
  }
}
