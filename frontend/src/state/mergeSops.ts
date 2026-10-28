import type { Sop, TimelineEventType } from '../data/mock/types'
import type { SopStatus } from '../types/status'

/*
 * SOPs come from the database, but approval isn't part of this delivery: approval
 * requests, approver comments and decisions, and the statuses only approval reaches,
 * are still kept only in this tab. These functions put the two together. Pure functions.
 */

/** Timeline events the database keeps (every kind of this delivery's features); approval events stay in the browser. */
const DATABASE_EVENTS = new Set<TimelineEventType>([
  'version-uploaded',
  'version-deleted',
  'co-author-added',
  'co-author-removed',
  'compliance-check-completed',
  'compliance-check-failed',
  'submitted',
  'resubmitted',
  'review-accepted',
  'review-declined',
  'review-withdrawn',
  'reviewer-removed',
  'review-completed',
  'review-changes-requested',
  'internal-review-completed',
  'response',
])

/** Statuses only the approval kept in this tab can reach; the database's In Review doesn't replace them. */
const APPROVAL_STATUSES = new Set<SopStatus>(['in-approval', 'approved', 'published'])

/**
 * An SOP read from the database, with the parts this tab already keeps for it. The
 * database wins for everything it owns (identity, title, department, author, co-authors,
 * versions and files, compliance checks, status, review rounds, reviewer comments and
 * its timeline events); the tab keeps the approval parts.
 */
export function mergeSop(stored: Sop, kept: Sop | undefined): Sop {
  if (!kept) return stored
  // A new review round (a new version sent) ends the earlier approval stage, as in lib/internalReview.ts.
  const newRound = stored.internalReviewRounds?.at(-1)?.id !== kept.internalReviewRounds?.at(-1)?.id
  return {
    ...kept,
    ...(newRound ? { approvers: [], reviewDueDays: undefined, reviewDueAt: undefined, approvalDueDays: undefined, approvalDueAt: undefined } : {}),
    id: stored.id,
    code: stored.code,
    title: stored.title,
    description: stored.description,
    departmentId: stored.departmentId,
    authorId: stored.authorId,
    coAuthorIds: stored.coAuthorIds,
    version: stored.version,
    status: APPROVAL_STATUSES.has(kept.status) ? kept.status : stored.status,
    fileName: stored.fileName,
    fileType: stored.fileType,
    fileUrl: undefined,
    versions: stored.versions,
    complianceChecks: stored.complianceChecks,
    internalReviewRounds: stored.internalReviewRounds,
    reviewers: stored.reviewers,
    comments: [...stored.comments, ...kept.comments.filter((comment) => comment.role === 'approver')]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    lastUpdated: stored.lastUpdated > kept.lastUpdated ? stored.lastUpdated : kept.lastUpdated,
    timeline: [...stored.timeline, ...kept.timeline.filter((event) => !DATABASE_EVENTS.has(event.type))]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }
}

/**
 * The tab's SOPs after reading `stored` from the database: new ones first, known ones
 * merged in place, and every other SOP kept (sample SOPs, and SOPs read while someone
 * else was signed in in this tab).
 */
export function mergeSops(current: Sop[], stored: Sop[]): Sop[] {
  const known = new Set(current.map((sop) => sop.id))
  const storedById = new Map(stored.map((sop) => [sop.id, sop]))
  return [
    ...stored.filter((sop) => !known.has(sop.id)),
    ...current.map((sop) => {
      const update = storedById.get(sop.id)
      return update ? mergeSop(update, sop) : sop
    }),
  ]
}
