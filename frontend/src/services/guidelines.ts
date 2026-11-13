/*
 * Managing GVP versions in the admin portal (supabase/migrations/20261108120000_guideline_versions_admin.sql).
 * A version an admin adds is kept apart from the published ones (guideline_version_drafts), so it is
 * never current. PDFs go to the private guideline-files bucket as "files/<random id>.pdf" and are
 * opened through signed links that last 10 minutes. Published versions are read in services/compliance.ts.
 */

import type { GuidelineProcessing, GuidelineVersion } from '../data/mock/types'
import { riyadhDate } from '../lib/riyadhWorkingDays'
import { SIGNED_URL_SECONDS } from './files'
import { supabase } from './supabase'

const BUCKET = 'guideline-files'

/** Why saving failed: a rule the database refused (its hint), or what went wrong around it. */
export type GuidelineFailure =
  | 'title-invalid'
  | 'version-invalid'
  | 'version-exists'
  | 'version-not-higher'
  | 'issued-required'
  | 'issued-after-added'
  | 'source-invalid'
  | 'file-not-pdf'
  | 'file-too-large'
  | 'file-missing'
  | 'file-in-use'
  | 'file-exists'
  /** Another added version is still waiting for or being processed (one at a time). */
  | 'version-processing'
  | 'upload'
  | 'permission'
  | 'other'

const HINTS: GuidelineFailure[] = [
  'title-invalid', 'version-invalid', 'version-exists', 'version-not-higher', 'issued-required', 'issued-after-added',
  'source-invalid', 'file-not-pdf', 'file-too-large', 'file-missing', 'file-in-use', 'file-exists', 'version-processing',
]

export class GuidelineError extends Error {
  readonly reason: GuidelineFailure
  constructor(reason: GuidelineFailure, message: string) {
    super(message)
    this.name = 'GuidelineError'
    this.reason = reason
  }
}

/** A database error as a GuidelineError: its hint, no permission (42501), or anything else. */
export function guidelineError(error: { message: string; code?: string; hint?: string | null }): GuidelineError {
  const hint = HINTS.find((item) => item === error.hint)
  if (hint) return new GuidelineError(hint, error.message)
  return new GuidelineError(error.code === '42501' ? 'permission' : 'other', error.message)
}

/** The details an admin saves. */
export interface GuidelineDetails {
  title: string
  version: string
  issuedDate: string
  source: string
}

interface AddedVersionRow {
  id: string
  name: string
  version: string
  issued_date: string
  source: string
  file_name: string
  storage_path: string
  file_size: number
  created_by: string
  created_at: string
  processing_status?: GuidelineProcessing['status'] | null
  processing_error?: string | null
  processing_report?: Record<string, unknown> | null
  processed_at?: string | null
  progress_percent?: number | null
  stage?: string | null
  stage_detail?: string | null
}

const PROCESSING_STATUSES: GuidelineProcessing['status'][] = ['waiting', 'processing', 'ready', 'failed']

/** The processing state of an added version, read defensively from its row. */
export function toGuidelineProcessing(row: Pick<AddedVersionRow, 'processing_status' | 'processing_error' | 'processing_report' | 'processed_at' | 'progress_percent' | 'stage' | 'stage_detail'>): GuidelineProcessing {
  const status = PROCESSING_STATUSES.includes(row.processing_status as GuidelineProcessing['status']) ? row.processing_status! : 'waiting'
  const raw = row.processing_report
  const count = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined)
  const texts = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [])
  const requirements = count(raw?.requirements)
  const sections = count(raw?.sections)
  const label = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)
  const percent = count(row.progress_percent)
  const stage = label(row.stage)
  const detail = label(row.stage_detail)
  const progress = status === 'processing' && (percent !== undefined || stage)
    ? { percent: Math.min(percent ?? 0, 100), ...(stage ? { stage } : {}), ...(stage && detail ? { detail } : {}) }
    : undefined
  return {
    status,
    ...(progress ? { progress } : {}),
    ...(status === 'failed' && row.processing_error ? { error: row.processing_error } : {}),
    ...(row.processed_at ? { processedAt: row.processed_at } : {}),
    ...(status === 'ready' && requirements !== undefined && sections !== undefined
      ? { report: { requirements, sections, ...(count(raw?.pages) ? { pages: count(raw?.pages) } : {}), warnings: texts(raw?.warnings), missingExcludedSections: texts(raw?.missing_excluded_sections) } }
      : {}),
  }
}

/** An added version as a GuidelineVersion: never current, with no requirements yet. */
export function toAddedGuidelineVersion(row: AddedVersionRow): GuidelineVersion {
  return {
    id: row.id,
    title: row.name,
    version: row.version,
    issuedDate: row.issued_date,
    effectiveDate: riyadhDate(new Date(row.created_at)),
    fileName: row.file_name,
    storagePath: row.storage_path,
    fileSize: row.file_size,
    source: row.source,
    addedById: row.created_by,
    addedAt: row.created_at,
    requirements: [],
    neverCurrent: true,
    processing: toGuidelineProcessing(row),
  }
}

/**
 * The versions admins added (only admins can read them), oldest first. One deleted while it was being
 * processed is left out: the compliance service is stopping and deleting it.
 */
export async function fetchAddedGuidelineVersions(): Promise<GuidelineVersion[]> {
  const { data, error } = await supabase()
    .from('guideline_version_drafts')
    .select('id, name, version, issued_date, source, file_name, storage_path, file_size, created_by, created_at, processing_status, processing_error, processing_report, processed_at, progress_percent, stage, stage_detail')
    .eq('cancel_requested', false)
    .order('created_at')
  if (error) throw new Error(error.message)
  return (data as AddedVersionRow[]).map(toAddedGuidelineVersion)
}

/** Uploads a PDF under a new random name (never replacing a file); returns where it is. */
export async function uploadGuidelineFile(file: File): Promise<string> {
  const storagePath = `files/${crypto.randomUUID()}.pdf`
  const { error } = await supabase().storage.from(BUCKET).upload(storagePath, file, { contentType: 'application/pdf', upsert: false })
  if (error) throw new GuidelineError('upload', error.message)
  return storagePath
}

/**
 * Removes a file no version uses (after a failed save, or of a deleted version). Best effort: a file
 * left behind is only unused storage, so a failure here isn't reported.
 */
export async function removeGuidelineFile(storagePath: string): Promise<void> {
  try {
    await supabase().storage.from(BUCKET).remove([storagePath])
  } catch {
    // Left in the bucket; nothing refers to it.
  }
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(name, args)
  if (error) throw guidelineError(error)
  return data as T
}

/** Adds a version with the PDF just uploaded. It is not current. Returns its id. */
export function createGuidelineVersion(details: GuidelineDetails, storagePath: string, fileName: string): Promise<string> {
  return call<string>('create_guideline_draft', {
    p_name: details.title, p_version: details.version, p_issued_date: details.issuedDate, p_source: details.source,
    p_storage_path: storagePath, p_file_name: fileName,
  })
}

/** Edits a version that was never current: title, version number, issue date and source. */
export async function updateAddedGuidelineVersion(id: string, details: GuidelineDetails): Promise<void> {
  await call('update_guideline_draft', {
    p_id: id, p_name: details.title, p_version: details.version, p_issued_date: details.issuedDate, p_source: details.source,
  })
}

/** Edits a published version: only its title, issue date and source. */
export async function updatePublishedGuidelineVersion(id: string, details: Omit<GuidelineDetails, 'version'>): Promise<void> {
  await call('update_guideline_version', { p_id: id, p_name: details.title, p_issued_date: details.issuedDate, p_source: details.source })
}

/** Adds the PDF just uploaded to a published version that has none. */
export async function attachGuidelineFile(id: string, storagePath: string): Promise<void> {
  await call('attach_guideline_file', { p_id: id, p_storage_path: storagePath })
}

/**
 * Deletes a version that was never current. 'deleted' with its file's path (for the browser to
 * remove), or 'cancelled' for a version being processed: the compliance service stops processing it
 * and deletes it with its files.
 */
export async function deleteAddedGuidelineVersion(id: string): Promise<{ outcome: 'deleted'; storagePath?: string } | { outcome: 'cancelled' }> {
  const result = await call<{ outcome?: string; storage_path?: string | null } | null>('delete_guideline_draft', { p_id: id })
  if (result?.outcome === 'cancel-requested') return { outcome: 'cancelled' }
  return { outcome: 'deleted', ...(result?.storage_path ? { storagePath: result.storage_path } : {}) }
}

/** A link to a version's PDF that works for 10 minutes. */
export async function signedGuidelineFileUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_SECONDS)
  if (error || !data) throw new Error(error?.message ?? 'No link was created')
  return data.signedUrl
}

/** Processes an added version again after processing failed. */
export async function retryGuidelineProcessing(id: string): Promise<void> {
  const { error } = await supabase().rpc('retry_guideline_processing', { p_id: id })
  if (error) throw guidelineError(error)
}

/** Makes a processed added version the current GVP version; returns its new (published) id. */
export async function makeGuidelineCurrent(id: string): Promise<string> {
  const { data, error } = await supabase().rpc('make_guideline_current', { p_id: id })
  if (error) throw guidelineError(error)
  return data as string
}

