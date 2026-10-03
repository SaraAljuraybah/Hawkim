import type {
  ReviewRole,
  Sop,
  SopComment,
  SopVersion,
  TimelineEvent,
  TimelineEventType,
} from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { todayIsoDate } from './format'

/*
 * SOP workflow rules (Sprint 0, PBI 6 / 8 / 12 / 22 / 24) as pure functions.
 * Each transition returns an updated copy of the SOP — status, versions,
 * comments, timeline and lastUpdated change together — or throws if the
 * action isn't allowed in the current status.
 *
 * Draft → In Review → (Returned) → In Approval → Approved → Published
 *
 * TODO: The backend must enforce these same rules; the browser only reflects them.
 */

/** A file the author uploads (only its name, type and an in-memory URL are kept). */
export interface UploadedFile {
  fileName: string
  fileType: Sop['fileType']
  fileUrl?: string
}

let counter = 0
function newId(prefix: string) {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

/** Version + 0.1 in decimal steps: 1.0 → 1.1, 1.9 → 2.0. */
export function nextVersion(version: string): string {
  return ((Math.round(Number(version) * 10) + 1) / 10).toFixed(1)
}

function event(sop: Sop, type: TimelineEventType, actorId: string, recipientId?: string, note?: string): TimelineEvent {
  return {
    id: newId('evt'),
    type,
    actorId,
    ...(recipientId ? { recipientId } : {}),
    version: sop.version,
    createdAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  }
}

function assertStatus(sop: Sop, allowed: SopStatus[], action: string) {
  if (!allowed.includes(sop.status)) throw new Error(`Can't ${action} an SOP that is ${sop.status}`)
}

/** The most recent "returned" event, if any. */
export function latestReturn(sop: Sop): TimelineEvent | undefined {
  return [...sop.timeline].reverse().find((item) => item.type === 'returned')
}

/** The step an SOP was returned from: In Review (by the reviewer) or In Approval (by the approver). */
export function returnedFrom(sop: Sop): 'in-review' | 'in-approval' | undefined {
  const returned = latestReturn(sop)
  if (!returned) return undefined
  return returned.actorId === sop.approverId ? 'in-approval' : 'in-review'
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

/** Author: first submission, choosing the reviewer and approver (PBI 6). */
export function submitForReview(sop: Sop, authorId: string, reviewerId: string, approverId: string, note?: string): Sop {
  assertStatus(sop, ['draft'], 'submit')
  if (reviewerId === approverId || reviewerId === authorId || approverId === authorId) {
    throw new Error('The author, reviewer and approver must be different people')
  }
  return {
    ...sop,
    status: 'in-review',
    reviewerId,
    approverId,
    lastUpdated: todayIsoDate(),
    timeline: [...sop.timeline, event(sop, 'submitted', authorId, reviewerId, note)],
  }
}

/** Author: replace the draft's file; the version stays the same. */
export function replaceFile(sop: Sop, authorId: string, file: UploadedFile): Sop {
  assertStatus(sop, ['draft'], 'replace the file of')
  const current: SopVersion = { ...sop.versions[sop.versions.length - 1], ...file, uploadedAt: new Date().toISOString() }
  return {
    ...sop,
    ...file,
    lastUpdated: todayIsoDate(),
    versions: [...sop.versions.slice(0, -1), current],
    timeline: [...sop.timeline, event(sop, 'file-replaced', authorId)],
  }
}

/** Author: upload a new version after a return (PBI 8 / 12); the version increases by 0.1. */
export function uploadNewVersion(sop: Sop, authorId: string, file: UploadedFile): Sop {
  assertStatus(sop, ['returned'], 'upload a new version of')
  const version = nextVersion(sop.version)
  const updated: Sop = { ...sop, ...file, version, lastUpdated: todayIsoDate() }
  return {
    ...updated,
    versions: [...sop.versions, { version, ...file, uploadedAt: new Date().toISOString() }],
    timeline: [...sop.timeline, event(updated, 'new-version-uploaded', authorId)],
  }
}

/** Author: resubmit to the same reviewer and approver; it goes through review and approval again. */
export function resubmit(sop: Sop, authorId: string, note?: string): Sop {
  if (!canResubmit(sop)) throw new Error('Upload a new version before resubmitting')
  return {
    ...sop,
    status: 'in-review',
    lastUpdated: todayIsoDate(),
    timeline: [...sop.timeline, event(sop, 'resubmitted', authorId, sop.reviewerId, note)],
  }
}

/** Reviewer (in review) or approver (in approval): return to the author with a comment. */
export function returnWithComment(sop: Sop, role: ReviewRole, text: string): Sop {
  assertStatus(sop, [role === 'reviewer' ? 'in-review' : 'in-approval'], 'return')
  const actorId = (role === 'reviewer' ? sop.reviewerId : sop.approverId) ?? ''
  const createdAt = new Date().toISOString()
  const comment: SopComment = { id: newId('com'), authorUserId: actorId, role, text, createdAt, version: sop.version }
  return {
    ...sop,
    status: 'returned',
    lastUpdated: todayIsoDate(),
    comments: [...sop.comments, comment],
    timeline: [...sop.timeline, { ...event(sop, 'returned', actorId, sop.authorId), createdAt }],
  }
}

/** Reviewer: send the SOP on to the approver. */
export function forwardToApprover(sop: Sop): Sop {
  assertStatus(sop, ['in-review'], 'forward')
  return {
    ...sop,
    status: 'in-approval',
    lastUpdated: todayIsoDate(),
    timeline: [...sop.timeline, event(sop, 'forwarded-to-approver', sop.reviewerId ?? '', sop.approverId)],
  }
}

/** Approver: approve the SOP. */
export function approve(sop: Sop): Sop {
  assertStatus(sop, ['in-approval'], 'approve')
  return {
    ...sop,
    status: 'approved',
    lastUpdated: todayIsoDate(),
    timeline: [...sop.timeline, event(sop, 'approved', sop.approverId ?? '')],
  }
}

/** Approver: publish the approved SOP; it then appears in the SOPs directory. */
export function publish(sop: Sop): Sop {
  assertStatus(sop, ['approved'], 'publish')
  return {
    ...sop,
    status: 'published',
    lastUpdated: todayIsoDate(),
    timeline: [...sop.timeline, event(sop, 'published', sop.approverId ?? '')],
  }
}
