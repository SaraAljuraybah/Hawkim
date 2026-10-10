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

export interface Department {
  id: DepartmentId
  name: string
  /** Short abbreviation shown in the initials circle, e.g. "QA". */
  initials: string
  /** One-line description of the department's function (may be empty). */
  description: string
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
   * Reviewers (then approvers) work in parallel: the stage completes when ALL have
   * decided, and ANY return sends the SOP back to the author.
   */
  reviewers: ReviewerAssignment[]
  approvers: ApproverAssignment[]
  /** Calendar days for each stage (1–30), set on the first submission. */
  reviewDueDays?: number
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
  /**
   * Set when the main author deleted this version. It is kept so version numbers are
   * never reused, but hidden everywhere (and its compliance reports are no longer listed).
   */
  deletedAt?: string
  deletedById?: string
}

/** Who gives feedback in the workflow. */
export type ReviewRole = 'reviewer' | 'approver'

export type ReviewerDecision = 'pending' | 'completed' | 'returned'
export type ApproverDecision = 'pending' | 'approved' | 'returned'

export interface ReviewerAssignment {
  userId: string
  decision: ReviewerDecision
  /** ISO date and time of the decision. */
  decidedAt?: string
}

export interface ApproverAssignment {
  userId: string
  decision: ApproverDecision
  decidedAt?: string
}

/** Actor id used for automatic workflow steps (shown as "System"). */
export const SYSTEM_ACTOR = 'system'

/** Feedback left when an SOP is returned to its author. */
export interface SopComment {
  id: string
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

/** One action in an SOP's workflow history (PBI 24). */
export interface TimelineEvent {
  id: string
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
  /** For stage-due-date-set: which stage and its due date (ISO date and time). */
  stage?: 'review' | 'approval'
  dueAt?: string
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
  /** A short descriptive name, e.g. "Training of personnel" (used in the report's top priorities). */
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
  /** What to change; only for results that aren't compliant. */
  recommendedAction?: string
}

/** The regulatory document a check is run against. */
export interface Guideline {
  name: string
  version: string
}

/**
 * One version of the SFDA GVP guideline (PBI 20). The latest one added is current;
 * older versions are read-only history and can't be edited or deleted.
 */
export interface GuidelineVersion {
  id: string
  /** e.g. "4.0" */
  version: string
  /** ISO dates. */
  issuedDate?: string
  effectiveDate: string
  /** The guideline document, e.g. "Drug-GVP4_0.pdf". */
  fileName: string
  /** What changed from the previous version. */
  summary?: string
  /** The admin who added it (User.id) and when (ISO date and time); unknown for the first version. */
  addedById?: string
  addedAt?: string
  /** The requirements SOPs are checked against. */
  requirements: Requirement[]
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
