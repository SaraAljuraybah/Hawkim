import type { Sop } from '../data/mock/types'
import { projectReviewers } from './internalReviewStatus'
import { isApprover, isReviewer } from './workflow'

/** A reviewer-facing view; historical membership never authorizes a newer file. */
export function reviewSopForUser(sop: Sop, userId: string): { sop: Sop; historical: boolean } | undefined {
  const approvalHistory = sop.approvalSubmissions?.filter((submission) => submission.approverId === userId) ?? []
  if (!isReviewer(sop, userId) && !isApprover(sop, userId) && !approvalHistory.length) return undefined
  const rounds = sop.internalReviewRounds
  // Preserve existing legacy and assigned-approver access rules.
  if (!sop.approvalSubmissions?.length && (!rounds?.length || isApprover(sop, userId))) return { sop, historical: false }

  const allowed = new Set((rounds ?? []).filter((round) => round.assignments.some((person) => person.userId === userId)).map((round) => round.version))
  for (const submission of approvalHistory) allowed.add(submission.version)
  // A subsequent review plan may have its own assignments, separate from internal history.
  if (sop.reviewers.some((current) => current.userId === userId && !(rounds ?? []).some((round) => round.assignments.some((person) => 'id' in current && person.id === current.id)))) allowed.add(sop.version)
  const deleted = new Set(sop.versions.filter((version) => version.deletedAt).map((version) => version.version))
  const visible = (version: string) => allowed.has(version) && !deleted.has(version)
  const versions = sop.versions.filter((version) => visible(version.version))
  const version = visible(sop.version) ? sop.version : versions.at(-1)?.version
  if (!version) return undefined
  const historical = version !== sop.version
  const file = versions.find((item) => item.version === version)
  if (historical && !file) return undefined
  const visibleRounds = (rounds ?? []).filter((round) => visible(round.version))
  const round = visibleRounds.filter((item) => item.version === version).at(-1)
  const approval = approvalHistory.filter((submission) => submission.version === version).at(-1)
  return {
    historical,
    sop: {
      ...sop,
      version,
      versions,
      complianceChecks: sop.complianceChecks.filter((check) => visible(check.version)),
      comments: sop.comments.filter((comment) => visible(comment.version)),
      timeline: sop.timeline.filter((event) => visible(event.version)),
      internalReviewRounds: visibleRounds,
      approvalSubmissions: sop.approvalSubmissions?.filter((submission) => visible(submission.version)),
      externalReviewGate: sop.externalReviewGate && visible(sop.externalReviewGate.version) ? sop.externalReviewGate : undefined,
      ...(historical ? {
        fileName: file!.fileName,
        fileType: file!.fileType,
        fileUrl: file!.fileUrl,
        status: approval ? approval.status === 'pending' ? 'in-approval' as const : approval.status : 'in-review' as const,
        reviewers: round ? projectReviewers(round) : [],
        approvers: approval ? [{ userId, version, decision: approval.status === 'pending' ? 'pending' as const : approval.status === 'returned' ? 'returned' as const : 'approved' as const, decidedAt: approval.decidedAt }] : [],
        reviewFlow: undefined,
        reviewDueDays: round?.assignedDueDays ?? undefined,
        reviewDueAt: round?.dueDate ? new Date(round.dueDate + 'T23:59:59.999').toISOString() : undefined,
        approvalDueAt: undefined,
        approvalDueDays: undefined,
      } : {}),
    },
  }
}
