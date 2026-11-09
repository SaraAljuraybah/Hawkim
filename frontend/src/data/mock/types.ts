import type { SopStatus, Status } from '../../types/status'

/*
 * Types for the sample data in src/data/mock/.
 * These describe the data the backend API will return later, so the
 * mock files can be swapped for API calls without changing components.
 */

/**
 * Extra features on top of the employee experience. Every user is an employee;
 * a user can have none, one or several permissions.
 */
export type Permission = 'author' | 'reviewer' | 'approver' | 'admin'

/** A user of Hawkim (an employee, with any extra permissions). */
export interface User {
  id: string
  name: string
  /** Sign-in email; unique among active users (compared ignoring case). */
  email: string
  initials: string
  /** The user's home department. */
  departmentId: DepartmentId
  /** The division of that department, when it has one. */
  divisionId?: string
  /** Saudi mobile number, stored as "+9665XXXXXXXX"; missing on older profiles. */
  phone?: string
  /** Job title; missing on older profiles. */
  position?: string
  permissions: Permission[]
  /**
   * Set when an admin deletes the user (ISO date and time). Deleted users can't
   * sign in and are hidden from lists and pickers, but their name stays on SOP history.
   */
  deletedAt?: string
}

/**
 * Department identifier, e.g. "quality-assurance" (see departments.ts). Admins can add
 * departments, so any string; an id never changes once created (users, SOPs and
 * requests link to departments by id).
 */
export type DepartmentId = string

export interface DepartmentWorkflowConfiguration {
  /** Explicit organization-supplied key. Equal keys identify the same division. */
  divisionId?: string
  /** Configured final controller for SOPs originating in this department. Must have Approver permission. */
  qualityControllerId?: string
  /** The GVP guideline applies to this department's SOPs (Pharmacovigilance): they need a compliance check before review. */
  requiresComplianceCheck?: boolean
}

export interface Department extends DepartmentWorkflowConfiguration {
  id: DepartmentId
  name: string
  /** Short abbreviation shown in the initials circle, e.g. "QA". */
  initials: string
  /** One-line description of the department's function (may be empty). */
  description: string
  /** The name of its division (`divisionId`), as shown; loaded with the department. */
  divisionName?: string
  /** The Quality department (database `is_quality`, only one): its Approvers approve every SOP. */
  isQuality?: boolean
  /**
   * Set when an admin removes the department (ISO date and time). Removed departments
   * are hidden everywhere, but their name stays on old requests.
   */
  removedAt?: string
}

/**
 * A Standard Operating Procedure at any stage of its lifecycle. One list holds every SOP:
 * the SOPs directory shows the published ones, My SOPs shows the author's own.
 */
export interface Sop {
  id: string
  /** e.g. "SOP-017" */
  code: string
  title: string
  departmentId: DepartmentId
  /**
   * "others": its department was deleted and its SOPs were moved to SOP Directory > Others. It keeps
   * departmentId (the removed department) for history; who may read it is unchanged (database rules).
   */
  directoryGroup?: 'others'
  /** Current version: a whole number without the "v", e.g. "3" (shown as "v3"). */
  version: string
  status: SopStatus
  /** ISO date, e.g. "2024-01-12" */
  lastUpdated: string
  /** Id of the main author (User.id), when known. */
  authorId?: string
  /** Co-authors can replace a draft's file and upload new versions, but not submit. */
  coAuthorIds: string[]
  description?: string
  /** Current file, e.g. "SOP-079.docx" (kept in sync with the last entry of `versions`). */
  fileName: string
  fileType: SopFileType
  /** URL of the current file, when one is available (e.g. "/sample-sops/SOP-078.pdf"). */
  fileUrl?: string
  /**
   * Chosen by the author on the first submission; resubmissions go to the same people.
   * Reviewers act sequentially. New submissions select reviewers as the review plan progresses.
   * Legacy records retain their existing approval assignments.
   */
  /** Present on SOPs using the selected-reviewer workflow; absent on legacy records. */
  reviewFlow?: ReviewFlow
  /** Version-linked internal parallel review history; absent on legacy SOPs. */
  internalReviewRounds?: InternalReviewRound[]
  /** Version/round-scoped external requirement, shared with future Author-controlled routing. */
  externalReviewGate?: ExternalReviewGate
  /** Author-controlled approval requests and their decisions, retained across revised versions. */
  approvalSubmissions?: ApprovalSubmission[]
  reviewers: ReviewerAssignment[]
  approvers: ApproverAssignment[]
  /** Review calendar offset (0 or greater); older records may have numeric 1–30 allocations. */
  reviewDueDays?: number
  /** Approval calendar allocation retains the existing 1–30 day range. */
  approvalDueDays?: number
  /** Due dates (ISO date and time) of the current round, when the stage has started. */
  reviewDueAt?: string
  approvalDueAt?: string
  /** Every uploaded version, oldest first (the last one is the current file). */
  versions: SopVersion[]
  /** Reviewer and approver feedback, oldest first. */
  comments: SopComment[]
  /** Workflow history, oldest first. */
  timeline: TimelineEvent[]
  /**
   * Every compliance check report, oldest first (PBI 4): running, completed or
   * failed, for every version. The newest one for the current version is "current".
   */
  complianceChecks: ComplianceCheck[]
}

/** One uploaded file of an SOP. */
export interface SopVersion {
  /** A whole number, e.g. "2" (shown as "v2"); every upload adds the next one. */
  version: string
  fileName: string
  fileType: SopFileType
  /** Who uploaded it (User.id), when known. */
  uploadedById?: string
  /** ISO date and time, e.g. "2026-09-24T09:30:00+03:00" */
  uploadedAt: string
  /** Only when the file is available (sample PDFs, or files uploaded in this session). */
  fileUrl?: string
  /** Where the file is in the sop-files bucket, for SOPs from the database (opened through a signed link). */
  storagePath?: string
  /**
   * Set when the main author deleted this version. It is kept so version numbers are
   * never reused, but hidden everywhere (and its compliance reports are no longer listed).
   */
  deletedAt?: string
  deletedById?: string
}

/** Who gives feedback in the workflow. */
export type ReviewRole = 'reviewer' | 'approver'

export type ReviewScope = 'same-division' | 'cross-division'
export type ReviewFlowStage = 'reviewer-1' | 'reviewer-2' | 'same-division-decision' | 'same-division-representative' | 'same-division-reviewer' | 'cross-division-decision' | 'cross-division-representative' | 'cross-division-reviewer' | 'quality-routing' | 'quality-approval'
export interface DepartmentReview {
  departmentId: string
  scope: ReviewScope
  representativeId: string
  reviewerId?: string
  completed: boolean
}
export interface ReviewFlow {
  stage: ReviewFlowStage
  activeReviewerId: string
  reviewer1Id: string
  reviewer2Id?: string
  sameDivision: 'pending' | 'skipped' | 'required'
  crossDivision: 'pending' | 'skipped' | 'required'
  departments: DepartmentReview[]
  qualityControllerId?: string
}

export type ReviewerDecision = 'pending' | 'completed' | 'returned' | 'cancelled'
export type ApproverDecision = 'pending' | 'approved' | 'returned'


export interface ReviewerAssignment {
  userId: string
  /** Beginning work does not submit a final decision. */
  startedAt?: string
  decision: ReviewerDecision
  /** Optional deadline for this reviewer (YYYY-MM-DD). */
  dueDate?: string
  /** Precise saved deadline for new date allocations; date-only historical assignments keep their old interpretation. */
  reviewDueAt?: string
  /** When a new deadline allocation began, retained separately from the current due date. */
  assignedAt?: string
  /** Original calendar-day allocation; null explicitly means no deadline. Undefined is legacy data. */
  assignedDueDays?: number | null
  /** ISO date and time of the decision. */
  decidedAt?: string
}


/**
 * An internal review request: pending until the reviewer accepts or declines (or it expires
 * when the response due date ends); only an accepted request can be completed or returned. The main
 * author can remove a reviewer at any time.
 */
export type InternalReviewDecision = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'removed' | 'completed' | 'returned'

export interface InternalReviewerAssignment extends Omit<ReviewerAssignment, 'decision' | 'startedAt'> {
  /** Saved precise deadlines; new prototype requests calculate them in Riyadh, without server enforcement. */
  responseDueAt?: string
  /** Missing on older in-memory requests; stored historical requests keep their original policy. */
  deadlinePolicy?: 'calendar-v1' | 'riyadh-working-days-v1'
  id: string
  decision: InternalReviewDecision
  /** When the request was sent. */
  assignedAt: string
  /** Deadline date to accept or decline; use responseDueAt when present and retain legacy date semantics otherwise. */
  responseDueDate?: string
  /** Optional duration (1–3,650): working days for tagged new requests, calendar days for historical requests. */
  reviewDurationDays?: number
  /** When the reviewer accepted the request. */
  acceptedAt?: string
  /** The review's last day (YYYY-MM-DD), fixed on acceptance when a duration was set. */
  reviewDueDate?: string
  /** Requests from before the Expired status: when the end of the response due date withdrew it. Also kept on those that became Expired. */
  withdrawnAt?: string
  /** Set when a pending request expired at the end of its response due date. */
  expiredAt?: string
  /** Set when the main author removed the reviewer from the round, with the required reason. */
  removedAt?: string
  removedById?: string
  removalReason?: string
  /** The status the request had when its reviewer was removed (their decision stays in the history). */
  decisionBeforeRemoval?: InternalReviewDecision
  /** Required when the reviewer declines. */
  declineReason?: string
  /** The comments of a return (required) or a completed review (optional). */
  commentId?: string
}

/** A reviewer's own closed request on an SOP they can no longer read: all they see of it (see my_closed_review_requests). */
export interface ClosedReviewRequest {
  id: string
  sopTitle: string
  version: string
  status: InternalReviewDecision
  reason?: string
  closedAt: string
}

/** Shared integration boundary: external routing can consume completed internal rounds. */
export interface InternalReviewRound {
  id: string
  scope: 'internal'
  version: string
  /** Open while anyone taking part hasn't finished (or nobody is); then completed, or changes-requested if anyone returned it. */
  status: 'open' | 'completed' | 'changes-requested'
  requestedById: string
  requestedAt: string
  /** Shared deadline for new requests; historical rounds may have distinct task dates. */
  dueDate?: string
  assignedDueDays: number | null
  closedAt?: string
  assignments: InternalReviewerAssignment[]
}

export interface ApproverAssignment {
  /** Present on Author-controlled approval requests; legacy assignments have no identity. */
  id?: string
  version?: string
  assignedAt?: string
  userId: string
  decision: ApproverDecision
  decidedAt?: string
}

/** Completion evidence supplied by the future external review workflow, never created by approval submission. */
export interface ExternalReviewEvidence {
  id: string
  departmentId: string
  userId: string
  version: string
  decision: ReviewerDecision
  decidedAt?: string
  feedbackRequired?: boolean
  feedbackAddressed?: boolean
}

export type ExternalReviewGate = { version: string; internalReviewRoundId: string } & (
  | { requirement: 'not-required'; confirmedById: string; confirmedAt: string }
  | { requirement: 'required'; departmentIds: string[]; assignments: ExternalReviewEvidence[] }
)

export interface ApprovalSubmission {
  id: string
  version: string
  internalReviewRoundId: string
  submittedById: string
  submittedAt: string
  approverId: string
  status: 'pending' | 'approved' | 'returned' | 'published'
  assignedDueDays: number | null
  /** Only on requests sent before the due date was removed from Submit for Approval. */
  dueDate?: string
  /** The main Author's optional comment for the approver (also on the timeline event). */
  note?: string
  /** The main Author acknowledged feedback on completed internal reviews. */
  feedbackAddressed?: boolean
  decidedAt?: string
  commentId?: string
}

/** Captured when opening an approval action; prevents a stale page acting on a later request. */
export interface ApprovalDecisionSnapshot {
  version: string
  approvalSubmissionId: string
}

/** Actor id used for automatic workflow steps (shown as "System"). */
export const SYSTEM_ACTOR = 'system'

/** Feedback left when an SOP is returned to its author. */
export interface SopComment {
  id: string
  reviewRoundId?: string
  reviewAssignmentId?: string
  authorUserId: string
  role: ReviewRole
  text: string
  /** ISO date and time */
  createdAt: string
  /** The version the comment is about. */
  version: string
}

export type TimelineEventType =
  | 'version-uploaded'
  | 'version-deleted'
  | 'response'
  | 'review-deadline-changed'
  | 'submitted'
  | 'resubmitted'
  | 'forwarded-to-approver'
  | 'returned'
  | 'approved'
  | 'published'
  | 'co-author-added'
  | 'co-author-removed'
  | 'review-completed'
  | 'approved-by'
  | 'stage-due-date-set'
  | 'compliance-check-completed'
  | 'compliance-check-failed'
  | 'routed'
  | 'review-assigned'
  | 'review-returned'
  | 'review-scope-decided'
  | 'review-accepted'
  | 'review-declined'
  | 'review-withdrawn'
  | 'review-expired'
  | 'review-request-resent'
  | 'reviewer-removed'
  | 'review-changes-requested'
  | 'internal-review-completed'
  | 'external-reviews-not-required'
  | 'submitted-for-approval'

/** One action in an SOP's workflow history (PBI 24). */
export interface TimelineEvent {
  id: string
  approvalSubmissionId?: string
  reviewRoundId?: string
  reviewAssignmentId?: string
  type: TimelineEventType
  /** Who did it (User.id, or SYSTEM_ACTOR for automatic steps). */
  actorId: string
  /** Who it was sent to, if anyone (User ids). */
  recipientIds?: string[]
  /** For co-author-added / co-author-removed: the co-author (User.id). */
  subjectId?: string
  /** For routed: the department of the reviewer it was routed to (as it was then). */
  departmentId?: DepartmentId
  /** The reviewer's or approver's comment made with this action (returned, review-completed, approved-by). */
  commentId?: string
  /** For review-deadline-changed: the deadline before (none if there wasn't one) and after. */
  previousReviewDueAt?: string
  newReviewDueAt?: string
  /** For stage-due-date-set: which stage and its due date (ISO date and time). */
  stage?: 'review' | 'approval'
  dueAt?: string
  /** Explicit same-division/cross-division decision, separate from free-text comments. */
  reviewScope?: ReviewScope
  reviewsRequired?: boolean
  version: string
  /** ISO date and time */
  createdAt: string
  note?: string
}

/* ---------- Compliance checks (PBI 4, 5, 29) ---------- */

/** How an SOP meets one requirement. */
export type ComplianceResult = 'compliant' | 'partial' | 'conflict' | 'not-addressed'

/** A regulatory requirement the SOP is checked against. */
export interface Requirement {
  /** e.g. "R1" */
  id: string
  /** e.g. "Module I" */
  module: string
  /** e.g. "I.B.10" */
  section: string
  sectionTitle: string
  /** A short descriptive name, e.g. "Training of personnel". */
  shortTitle: string
  /** Page in the guideline document. */
  page: number
  /** Paraphrased summary of the requirement. */
  summary: string
}

/** The result for one requirement, with its justification (PBI 5). */
export interface Finding {
  id: string
  requirementId: string
  result: ComplianceResult
  justification: string
  /** Where the SOP addresses it, e.g. "Section 4.2" (none when it isn't addressed). */
  sopReference?: string
  /**
   * The SOP text behind the result, in the order the compliance service checked the steps: each
   * step's section (e.g. "5-4-2"), its page in the SOP, if known, and the sentences quoted from it.
   * None for sample results.
   */
  sopEvidence?: { section: string; page?: number; text: string }[]
  /** What to change; only for results that aren't compliant. */
  recommendedAction?: string
  /**
   * The requirement's details, read with the finding from the database. The compliance
   * service adds requirements while checks run, so the guideline list loaded at sign-in
   * may not have them yet; the report uses these details first.
   */
  requirement?: Requirement
}

/** The regulatory document a check is run against. */
export interface Guideline {
  name: string
  version: string
}

/**
 * One version of the SFDA GVP guideline (PBI 20). The published version added last is current.
 * A version an admin adds is never current (`neverCurrent`) until it is made current (later).
 */
/** How far the compliance service has got with an added version (GVP phase 2). */
export interface GuidelineProcessing {
  status: 'waiting' | 'processing' | 'ready' | 'failed'
  /** Why processing failed. */
  error?: string
  /** When processing finished (ISO date and time). */
  processedAt?: string
  /** How far processing has got, while processing (reading the PDF, embedding in batches, saving). */
  progress?: { stage: 'reading' | 'embedding' | 'saving'; done: number; total: number }
  /** What the service found in the PDF, once it is ready. */
  report?: { requirements: number; sections: number; pages?: number; warnings: string[]; missingExcludedSections: string[] }
}

export interface GuidelineVersion {
  id: string
  /** e.g. "SFDA Guideline on Good Pharmacovigilance Practices (GVP)" (the database `name`). */
  title?: string
  /** e.g. "4.0", entered by the admin. */
  version: string
  /** When SFDA issued it (ISO date), if known. */
  issuedDate?: string
  /** Kept for the database; Hawkim no longer shows it (a new version gets its added date). */
  effectiveDate: string
  /** The guideline document, e.g. "Drug-GVP4_0.pdf". */
  fileName: string
  /** A link to a sample PDF (prototype data only); stored PDFs use `storagePath`. */
  fileUrl?: string
  /** The PDF in the private guideline-files bucket, opened through a signed link; none yet for some versions. */
  storagePath?: string
  /** The PDF's size in bytes, when stored. */
  fileSize?: number
  /** A link to the guideline on the SFDA website (https://…sfda.gov.sa…), if known. */
  source?: string
  /** The admin who added it (User.id) and when (ISO date and time); unknown for the first version. */
  addedById?: string
  addedAt?: string
  /** The requirements SOPs are checked against (none yet for a version an admin added). */
  requirements: Requirement[]
  /** Added by an admin and never current: it can be deleted, and its version number changed. */
  neverCurrent?: boolean
  /** For an added version: processing by the compliance service before it can be made current. */
  processing?: GuidelineProcessing
}

/** One compliance check of one SOP version; its report is kept (PBI 4). */
export interface ComplianceCheck {
  id: string
  sopId: string
  /** The SOP version that was checked. */
  version: string
  status: 'running' | 'completed' | 'failed'
  /** ISO date and time */
  startedAt: string
  completedAt?: string
  /**
   * Who ran the check: the person who uploaded the version (automatic check after an
   * upload) or who pressed Check. Its timeline events are attributed to them.
   */
  triggeredById?: string
  /** What produced the result, for checks from the database: 'sample' (sample findings) or the compliance service's name ('hawkim'). */
  engine?: string
  /** How many SOP procedures (steps) the compliance service checked; unknown for sample results. */
  stepsChecked?: number
  guideline: Guideline
  /** Empty until the check completes. */
  findings: Finding[]
}

/** File formats an SOP can be uploaded in. */
export type SopFileType = 'pdf' | 'docx'

/** Identifies each dashboard statistic (its label and icon come from the content file). */
export type DashboardStatKey = 'myRequests' | 'sops' | 'employees'

export interface DashboardStat {
  key: DashboardStatKey
  value: number
}

/** What an activity item is about; decides its icon. */
export type ActivityKind = 'accessRequest' | 'departmentMembership' | 'sopRequest'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  message: string
  /** Display string for now (e.g. "2 hours ago"); will become a timestamp from the API. */
  timeAgo: string
  /** Optional: items without a status show no badge. */
  status?: Status
}

/** Kinds of request a user can send to the admin team. */
export type RequestType = 'department-access' | 'permission-change' | 'role-change'

/** A request sent to the admin team. Requests cannot be edited; a pending one can be cancelled. */
export interface UserRequest {
  id: string
  title: string
  type: RequestType
  /** Only for department-access requests: the department asked for. */
  departmentId?: DepartmentId
  description: string
  /** ISO date, e.g. "2024-01-12" (shown in My Requests). */
  createdAt: string
  /** ISO date and time it was sent; only for requests sent in the app (the samples have just a date). */
  submittedAt?: string
  status: Status
  /** Who sent it (User.id). */
  requesterId: string
  /** The admin who approved or rejected it (User.id), and when (ISO date and time). */
  decidedById?: string
  decidedAt?: string
}
