/*
 * The GVP guideline and compliance checks in the database (see supabase/migrations/).
 * Checks are read with each SOP (services/sops.ts); here are the guideline versions (with how many
 * requirement passages each has), a version's passages (read on its own page only: a version can
 * have about 1,500), and the two functions that run a check.
 *
 * SAMPLE ENGINE: the real compliance service (BGE-M3 + Llama 3.1 8B) isn't connected
 * yet. A check is started in the database and finished by the browser a few seconds
 * later with the sample findings. TODO: The service will finish its own checks.
 */

import type { CheckProcedure, CheckProcedures, GuidelineVersion, Requirement } from '../data/mock/types'
import { CheckAlreadyCompletedError } from '../lib/compliance'
import { supabase } from './supabase'

/** The hint start_compliance_check raises when this version already has a completed check. */
export const CHECK_ALREADY_COMPLETED_HINT = 'check-already-completed'

const GUIDELINE_COLUMNS = `id, name, version, issued_date, effective_date, file_name, added_by, added_at, source, storage_path, file_size, draft_id,
  guideline_requirements!guideline_requirements_guideline_version_id_fkey (count)`

/** A version's passages are read in pages of this many (the API returns at most 1,000 rows at a time). */
const PASSAGES_PAGE = 1000

export interface GuidelineVersionRow {
  id: string
  name: string
  version: string
  issued_date: string | null
  effective_date: string
  file_name: string
  added_by: string | null
  added_at: string
  source: string | null
  storage_path: string | null
  file_size: number | null
  /** How many requirement passages it has: [{ count }]. */
  guideline_requirements: { count: number }[]
  /** The added version this one was published from (GVP phase 2); null for the others. */
  draft_id?: string | null
}

/** One of a version's requirement passages, as guideline_requirements stores it. */
interface GuidelineRequirementRow {
  code: string
  module: string
  section: string
  section_title: string
  short_title: string
  page: number
  summary: string
}

/** A guideline row as a GuidelineVersion: its passages aren't loaded, only how many there are. */
export function toGuidelineVersion(row: GuidelineVersionRow): GuidelineVersion {
  return {
    id: row.id,
    title: row.name,
    version: row.version,
    ...(row.draft_id ? { fromDraftId: row.draft_id } : {}),
    ...(row.issued_date ? { issuedDate: row.issued_date } : {}),
    effectiveDate: row.effective_date,
    fileName: row.file_name,
    ...(row.added_by ? { addedById: row.added_by } : {}),
    addedAt: row.added_at,
    ...(row.source ? { source: row.source } : {}),
    ...(row.storage_path ? { storagePath: row.storage_path } : {}),
    ...(row.file_size ? { fileSize: row.file_size } : {}),
    requirements: [],
    requirementCount: row.guideline_requirements?.[0]?.count ?? 0,
  }
}

/** A version's requirement passages in code order (R1, R2… R10; I.B.7#2 before I.B.7#10), read in pages. */
export async function fetchGuidelineRequirements(versionId: string): Promise<Requirement[]> {
  const rows: GuidelineRequirementRow[] = []
  for (let from = 0; ; from += PASSAGES_PAGE) {
    const { data, error } = await supabase()
      .from('guideline_requirements')
      .select('code, module, section, section_title, short_title, page, summary')
      .eq('guideline_version_id', versionId)
      .order('code')
      .range(from, from + PASSAGES_PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data as GuidelineRequirementRow[]))
    if (data.length < PASSAGES_PAGE) break
  }
  return rows
    .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
    .map((item) => ({
      id: item.code,
      module: item.module,
      section: item.section,
      sectionTitle: item.section_title,
      shortTitle: item.short_title,
      page: item.page,
      summary: item.summary,
    }))
}

/**
 * Whether the user's organization has a regulatory guideline to check against, and if not, why
 * (guideline_availability, 20261120130000): 'available' (a current version), 'processing' (an added version is
 * waiting or being processed), 'unpublished' (processed, not current), 'failed', 'cancelled', or 'none' (never added).
 */
export type GuidelineAvailability = 'available' | 'processing' | 'unpublished' | 'failed' | 'cancelled' | 'none'
const AVAILABILITY: readonly GuidelineAvailability[] = ['available', 'processing', 'unpublished', 'failed', 'cancelled', 'none']

/** Asks the database (for the signed-in user's organization only). Throws when it can't be read. */
export async function fetchGuidelineAvailability(): Promise<GuidelineAvailability> {
  const { data, error } = await supabase().rpc('guideline_availability')
  if (error) throw new Error(error.message)
  if (!AVAILABILITY.includes(data as GuidelineAvailability)) throw new Error('Unknown guideline availability')
  return data as GuidelineAvailability
}

/** Every published guideline version, oldest first (the last one added is current). */
export async function fetchGuidelineVersions(): Promise<GuidelineVersion[]> {
  const { data, error } = await supabase().from('guideline_versions').select(GUIDELINE_COLUMNS).order('added_at')
  if (error) throw new Error(error.message)
  return (data as GuidelineVersionRow[]).map(toGuidelineVersion)
}

/**
 * compliance_check_procedures' result as CheckProcedures. Procedures without an id or text are left out,
 * each id once (the first). A steps_checked that isn't a positive whole number is unknown. Anything
 * malformed reads as no procedures.
 */
export function toCheckProcedures(data: unknown): CheckProcedures {
  const value = data && typeof data === 'object' ? (data as { steps_checked?: unknown; procedures?: unknown }) : {}
  const steps = value.steps_checked
  const seen = new Set<string>()
  const procedures = (Array.isArray(value.procedures) ? value.procedures : []).flatMap((item: unknown): CheckProcedure[] => {
    if (!item || typeof item !== 'object') return []
    const { chunk_id: id, heading, page, text } = item as { chunk_id?: unknown; heading?: unknown; page?: unknown; text?: unknown }
    const chunkId = typeof id === 'string' ? id.trim() : ''
    const body = typeof text === 'string' ? text.trim() : ''
    if (!chunkId || !body || seen.has(chunkId)) return []
    seen.add(chunkId)
    return [{
      chunkId,
      ...(typeof heading === 'string' && heading.trim() ? { heading: heading.trim() } : {}),
      ...(typeof page === 'number' && Number.isInteger(page) && page > 0 ? { page } : {}),
      text: body,
    }]
  })
  return {
    ...(typeof steps === 'number' && Number.isInteger(steps) && steps > 0 ? { stepsChecked: steps } : {}),
    procedures,
  }
}

/**
 * A completed check's procedures and how many steps were checked (compliance_check_procedures: only
 * these values of the check's metadata, for a check the user may see). Throws when it can't be read,
 * including for a check the user may not see or that isn't completed.
 */
export async function fetchCheckProcedures(checkId: string): Promise<CheckProcedures> {
  const { data, error } = await supabase().rpc('compliance_check_procedures', { p_check_id: checkId })
  if (error) throw new Error(error.message)
  if (data === null || data === undefined) throw new Error('compliance check not found')
  return toCheckProcedures(data)
}

/** Starts a check of the SOP's current version against the current guideline; returns its id. */
export async function startComplianceCheck(sopId: string): Promise<string> {
  const { data, error } = await supabase().rpc('start_compliance_check', { p_sop_id: sopId })
  if (error?.hint === CHECK_ALREADY_COMPLETED_HINT) throw new CheckAlreadyCompletedError(error.message)
  if (error) throw new Error(error.message)
  return data as string
}

/** SAMPLE ENGINE ONLY: finishes a running sample check, with the sample findings or as failed. */
export async function finishSampleCheck(checkId: string, outcome: 'completed' | 'failed'): Promise<void> {
  const { error } = await supabase().rpc('finish_sample_check', { p_check_id: checkId, p_outcome: outcome })
  if (error) throw new Error(error.message)
}
