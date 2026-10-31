/*
 * SOPs, their versions and their timeline from the database (tables sops,
 * sop_versions and timeline_events; see supabase/migrations/). Rows are turned into
 * the app's existing Sop type, so screens don't change. Row level security decides
 * which SOPs a person can read; every change goes through a database function.
 *
 * Approval isn't part of this delivery: its parts are still kept in the browser
 * (see state/SopsProvider.tsx).
 */

import {
  SYSTEM_ACTOR,
  type ComplianceCheck,
  type ComplianceResult,
  type InternalReviewDecision,
  type InternalReviewRound,
  type InternalReviewerAssignment,
  type Sop,
  type SopComment,
  type SopFileType,
  type SopVersion,
  type TimelineEvent,
  type TimelineEventType,
} from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { todayIsoDate } from '../lib/format'
import { projectReviewers } from '../lib/internalReviewStatus'
import { WORKING_DAY_DEADLINES_ACTIVE } from '../lib/deadlinePolicy'
import { sopTitleProblem } from '../lib/sopTitle'
import { supabase } from './supabase'

/*
 * The relationships are named: sops and sop_versions are linked twice (each version's SOP, and
 * the SOP's current version), so the API can't tell which one is meant otherwise.
 * Every selected column exists in the approved schema (supabase/migrations/). The saved
 * deadlines (response_due_at, review_due_at) are authoritative and shown as saved.
 * deadline_policy exists only after the proposed working-day migration (supabase/proposals/),
 * so it is selected only once WORKING_DAY_DEADLINES_ACTIVE is switched on in the same change.
 */
const REQUEST_POLICY_COLUMN = WORKING_DAY_DEADLINES_ACTIVE ? ' deadline_policy,' : ''
const SOP_COLUMNS = `id, code, title, description, department_id, author_id, status, current_version, updated_at,
  sop_versions!sop_versions_sop_id_fkey (version, file_name, file_type, storage_path, uploaded_by, uploaded_at, deleted_at, deleted_by),
  sop_co_authors!sop_co_authors_sop_id_fkey (user_id, added_at),
  timeline_events!timeline_events_sop_id_fkey (id, type, actor_id, version, recipient_ids, subject_id, note, created_at,
    review_round_id, review_request_id, comment_id),
  review_rounds!review_rounds_sop_id_fkey (id, version, status, requested_by, requested_at, closed_at,
    review_requests!review_requests_round_id_fkey (id, seq, reviewer_id, status, assigned_at, response_due_date, response_due_at,
      review_duration_days, accepted_at, review_due_date, review_due_at,${REQUEST_POLICY_COLUMN} decided_at, decline_reason, comment_id, withdrawn_at,
      removed_at, removed_by, removal_reason, status_before_removal)),
  sop_comments!sop_comments_sop_id_fkey (id, version, author_id, role, text, review_round_id, review_request_id, created_at),
  compliance_checks!compliance_checks_sop_id_fkey (id, sop_version, status, engine, triggered_by, started_at, completed_at,
    guideline_versions!compliance_checks_guideline_version_id_fkey (name, version),
    compliance_findings!compliance_findings_check_id_fkey (id, result, justification, sop_reference, recommended_action, position,
      guideline_requirements!compliance_findings_requirement_id_fkey (code)))`

export interface SopVersionRow {
  version: number
  file_name: string
  file_type: SopFileType
  storage_path: string
  uploaded_by: string
  uploaded_at: string
  deleted_at: string | null
  deleted_by: string | null
}

export interface TimelineEventRow {
  id: string
  type: TimelineEventType
  actor_id: string | null
  version: number
  recipient_ids: string[]
  subject_id: string | null
  note: string | null
  created_at: string
  review_round_id: string | null
  review_request_id: string | null
  comment_id: string | null
}

export interface ReviewRequestRow {
  id: string
  seq: number
  reviewer_id: string
  status: InternalReviewDecision
  assigned_at: string
  response_due_date: string | null
  response_due_at?: string | null
  review_duration_days: number | null
  accepted_at: string | null
  review_due_date: string | null
  review_due_at?: string | null
  deadline_policy?: InternalReviewerAssignment['deadlinePolicy'] | null
  decided_at: string | null
  decline_reason: string | null
  comment_id: string | null
  withdrawn_at: string | null
  removed_at: string | null
  removed_by: string | null
  removal_reason: string | null
  status_before_removal: InternalReviewDecision | null
}

export interface ReviewRoundRow {
  id: string
  version: number
  status: InternalReviewRound['status']
  requested_by: string
  requested_at: string
  closed_at: string | null
  review_requests: ReviewRequestRow[]
}

export interface SopCommentRow {
  id: string
  version: number
  author_id: string
  role: SopComment['role']
  text: string
  review_round_id: string | null
  review_request_id: string | null
  created_at: string
}

export interface ComplianceCheckRow {
  id: string
  sop_version: number
  status: ComplianceCheck['status']
  engine: string
  triggered_by: string
  started_at: string
  completed_at: string | null
  guideline_versions: { name: string; version: string }
  compliance_findings: {
    id: string
    result: ComplianceResult
    justification: string
    sop_reference: string | null
    recommended_action: string | null
    position: number
    guideline_requirements: { code: string }
  }[]
}

export interface SopRow {
  id: string
  code: string
  title: string
  description: string
  department_id: string
  author_id: string
  status: SopStatus
  current_version: number
  updated_at: string
  sop_versions: SopVersionRow[]
  sop_co_authors: { user_id: string; added_at: string }[]
  timeline_events: TimelineEventRow[]
  compliance_checks: ComplianceCheckRow[]
  review_rounds: ReviewRoundRow[]
  sop_comments: SopCommentRow[]
}

function toVersion(row: SopVersionRow): SopVersion {
  return {
    version: String(row.version),
    fileName: row.file_name,
    fileType: row.file_type,
    uploadedById: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    storagePath: row.storage_path,
    ...(row.deleted_at ? { deletedAt: row.deleted_at, deletedById: row.deleted_by ?? undefined } : {}),
  }
}

function toEvent(row: TimelineEventRow): TimelineEvent {
  return {
    id: row.id,
    type: row.type,
    actorId: row.actor_id ?? SYSTEM_ACTOR,
    version: String(row.version),
    createdAt: row.created_at,
    ...(row.recipient_ids.length ? { recipientIds: row.recipient_ids } : {}),
    ...(row.subject_id ? { subjectId: row.subject_id } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.review_round_id ? { reviewRoundId: row.review_round_id } : {}),
    ...(row.review_request_id ? { reviewAssignmentId: row.review_request_id } : {}),
    ...(row.comment_id ? { commentId: row.comment_id } : {}),
  }
}

/** Only the fields that are set, so a request looks like one made in the browser. */
function toRequest(row: ReviewRequestRow): InternalReviewerAssignment {
  const optional = {
    responseDueDate: row.response_due_date,
    responseDueAt: row.response_due_at,
    reviewDurationDays: row.review_duration_days,
    acceptedAt: row.accepted_at,
    reviewDueDate: row.review_due_date,
    reviewDueAt: row.review_due_at,
    deadlinePolicy: row.deadline_policy,
    decidedAt: row.decided_at,
    declineReason: row.decline_reason,
    commentId: row.comment_id,
    withdrawnAt: row.withdrawn_at,
    removedAt: row.removed_at,
    removedById: row.removed_by,
    removalReason: row.removal_reason,
    decisionBeforeRemoval: row.status_before_removal,
  }
  return {
    id: row.id,
    userId: row.reviewer_id,
    decision: row.status,
    assignedAt: row.assigned_at,
    assignedDueDays: null,
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value != null)),
  }
}

function toRound(row: ReviewRoundRow): InternalReviewRound {
  return {
    id: row.id,
    scope: 'internal',
    version: String(row.version),
    status: row.status,
    requestedById: row.requested_by,
    requestedAt: row.requested_at,
    assignedDueDays: null,
    ...(row.closed_at ? { closedAt: row.closed_at } : {}),
    // In the order they were sent (a reviewer's latest request counts).
    assignments: [...row.review_requests].sort((a, b) => a.seq - b.seq).map(toRequest),
  }
}

function toComment(row: SopCommentRow): SopComment {
  return {
    id: row.id,
    authorUserId: row.author_id,
    role: row.role,
    text: row.text,
    version: String(row.version),
    createdAt: row.created_at,
    ...(row.review_round_id ? { reviewRoundId: row.review_round_id } : {}),
    ...(row.review_request_id ? { reviewAssignmentId: row.review_request_id } : {}),
  }
}

function toCheck(sopId: string, row: ComplianceCheckRow): ComplianceCheck {
  return {
    id: row.id,
    sopId,
    version: String(row.sop_version),
    status: row.status,
    engine: row.engine,
    startedAt: row.started_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    triggeredById: row.triggered_by,
    guideline: { name: row.guideline_versions.name, version: row.guideline_versions.version },
    findings: [...row.compliance_findings]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        id: item.id,
        // The report finds the requirement by its code (R1…) in the guideline version.
        requirementId: item.guideline_requirements.code,
        result: item.result,
        justification: item.justification,
        ...(item.sop_reference ? { sopReference: item.sop_reference } : {}),
        ...(item.recommended_action ? { recommendedAction: item.recommended_action } : {}),
      })),
  }
}

/** An SOP row as a Sop: versions and events oldest first, the current file from the current version. */
export function toSop(row: SopRow): Sop {
  const versions = [...row.sop_versions].sort((a, b) => a.version - b.version).map(toVersion)
  const current = versions.find((item) => item.version === String(row.current_version))
  const rounds = [...row.review_rounds].sort((a, b) => a.requested_at.localeCompare(b.requested_at)).map(toRound)
  const latestRound = rounds.at(-1)
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    departmentId: row.department_id,
    authorId: row.author_id,
    version: String(row.current_version),
    status: row.status,
    lastUpdated: todayIsoDate(new Date(row.updated_at)),
    fileName: current?.fileName ?? '',
    fileType: current?.fileType ?? 'pdf',
    // In the order they were added.
    coAuthorIds: [...row.sop_co_authors].sort((a, b) => a.added_at.localeCompare(b.added_at)).map((item) => item.user_id),
    // The latest round's reviewers, as the shared views (people list, user administration) read them.
    reviewers: latestRound ? projectReviewers(latestRound) : [],
    approvers: [],
    versions,
    ...(rounds.length ? { internalReviewRounds: rounds } : {}),
    comments: [...row.sop_comments].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(toComment),
    timeline: [...row.timeline_events].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(toEvent),
    // Oldest first: the newest check of the current version is "current".
    complianceChecks: [...row.compliance_checks].sort((a, b) => a.started_at.localeCompare(b.started_at)).map((check) => toCheck(row.id, check)),
  }
}

/** Every SOP the signed-in person may read. */
export async function fetchSops(): Promise<Sop[]> {
  const { data, error } = await supabase().from('sops').select(SOP_COLUMNS).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  // Without the schema's types the client can't tell single embeds from lists, so the rows are cast.
  return (data as unknown as SopRow[]).map(toSop)
}

/** One SOP, or null when the person may not read it (or it doesn't exist). */
export async function fetchSop(sopId: string): Promise<Sop | null> {
  const { data, error } = await supabase().from('sops').select(SOP_COLUMNS).eq('id', sopId).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toSop(data as unknown as SopRow) : null
}

/** A file already uploaded to the sop-files bucket (see services/files.ts). */
export interface StoredFile {
  storagePath: string
  fileName: string
}

/** Creates an SOP in the author's home department with its first version; returns its id. */
export async function createSop(input: { title: string; description?: string; departmentId: string; file: StoredFile }): Promise<string> {
  if (sopTitleProblem(input.title)) throw new Error('An SOP title of 1 to 50 characters is required')
  const { data, error } = await supabase().rpc('create_sop', {
    p_title: input.title.trim(),
    p_description: input.description ?? '',
    p_department_id: input.departmentId,
    p_storage_path: input.file.storagePath,
    p_file_name: input.file.fileName,
  })
  if (error) throw new Error(error.message)
  return data as string
}

/** Adds the next version of an SOP (the main author); returns its number. */
export async function uploadSopVersion(sopId: string, file: StoredFile): Promise<string> {
  const { data, error } = await supabase().rpc('upload_sop_version', {
    p_sop_id: sopId,
    p_storage_path: file.storagePath,
    p_file_name: file.fileName,
  })
  if (error) throw new Error(error.message)
  return String(data)
}

/** Marks a version deleted (its number and file are kept). */
export async function deleteSopVersion(sopId: string, version: string): Promise<void> {
  const { error } = await supabase().rpc('delete_sop_version', { p_sop_id: sopId, p_version: Number(version) })
  if (error) throw new Error(error.message)
}

/** Main author: adds co-authors (all or none). */
export async function addCoAuthors(sopId: string, userIds: string[]): Promise<void> {
  const { error } = await supabase().rpc('add_co_authors', { p_sop_id: sopId, p_user_ids: userIds })
  if (error) throw new Error(error.message)
}

/** Main author: removes a co-author. */
export async function removeCoAuthor(sopId: string, userId: string): Promise<void> {
  const { error } = await supabase().rpc('remove_co_author', { p_sop_id: sopId, p_user_id: userId })
  if (error) throw new Error(error.message)
}
