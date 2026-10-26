/*
 * SOPs, their versions and their timeline from the database (tables sops,
 * sop_versions and timeline_events; see supabase/migrations/). Rows are turned into
 * the app's existing Sop type, so screens don't change. Row level security decides
 * which SOPs a person can read; every change goes through a database function.
 *
 * Only the fields the database owns are filled here. Review requests and comments
 * are still kept in the browser (see state/SopsProvider.tsx).
 */

import { SYSTEM_ACTOR, type ComplianceCheck, type ComplianceResult, type Sop, type SopFileType, type SopVersion, type TimelineEvent, type TimelineEventType } from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { todayIsoDate } from '../lib/format'
import { supabase } from './supabase'

/*
 * The relationships are named: sops and sop_versions are linked twice (each version's SOP, and
 * the SOP's current version), so the API can't tell which one is meant otherwise.
 */
const SOP_COLUMNS = `id, code, title, description, department_id, author_id, status, current_version, updated_at,
  sop_versions!sop_versions_sop_id_fkey (version, file_name, file_type, storage_path, uploaded_by, uploaded_at, deleted_at, deleted_by),
  sop_co_authors!sop_co_authors_sop_id_fkey (user_id, added_at),
  timeline_events!timeline_events_sop_id_fkey (id, type, actor_id, version, recipient_ids, subject_id, note, created_at),
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
    reviewers: [],
    approvers: [],
    versions,
    comments: [],
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
  const { data, error } = await supabase().rpc('create_sop', {
    p_title: input.title,
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
