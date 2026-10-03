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

/** The signed-in user. */
export interface User {
  id: string
  name: string
  initials: string
  /** The user's home department. */
  departmentId: DepartmentId
  permissions: Permission[]
}

/** Department identifiers (see departments.ts). */
export type DepartmentId =
  | 'quality-assurance'
  | 'regulatory-affairs'
  | 'pharmacovigilance'
  | 'research-development'
  | 'information-technology'
  | 'human-resources'
  | 'finance-administration'
  | 'clinical-operations'
  | 'legal-governance'

export interface Department {
  id: DepartmentId
  name: string
  /** Short abbreviation shown in the initials circle, e.g. "QA". */
  initials: string
  /** One-line description of the department's function. */
  description: string
  memberCount: number
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
  /** Current version number without the "v", e.g. "2.1" */
  version: string
  status: SopStatus
  /** ISO date, e.g. "2024-01-12" */
  lastUpdated: string
  /** Id of the author (User.id), when known. */
  authorId?: string
  description?: string
  /** Current file, e.g. "SOP-079.docx". */
  fileName: string
  fileType: SopFileType
  /** URL of the current file, when one is available (e.g. "/sample-sops/SOP-078.pdf"). */
  fileUrl?: string
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
  /** ISO date, e.g. "2024-01-12" */
  createdAt: string
  status: Status
}
