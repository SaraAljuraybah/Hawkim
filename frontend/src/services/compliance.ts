/*
 * The GVP guideline and compliance checks in the database (see supabase/migrations/).
 * Checks are read with each SOP (services/sops.ts); here are the guideline versions with
 * their requirements, and the two functions that run a check.
 *
 * SAMPLE ENGINE: the real compliance service (BGE-M3 + Llama 3.1 8B) isn't connected
 * yet. A check is started in the database and finished by the browser a few seconds
 * later with the sample findings. TODO: The service will finish its own checks.
 */

import type { GuidelineVersion } from '../data/mock/types'
import { supabase } from './supabase'

const GUIDELINE_COLUMNS = `id, version, issued_date, effective_date, file_name, summary, added_by, added_at,
  guideline_requirements!guideline_requirements_guideline_version_id_fkey (code, module, section, section_title, short_title, page, summary)`

export interface GuidelineVersionRow {
  id: string
  version: string
  issued_date: string | null
  effective_date: string
  file_name: string
  summary: string
  added_by: string | null
  added_at: string
  guideline_requirements: {
    code: string
    module: string
    section: string
    section_title: string
    short_title: string
    page: number
    summary: string
  }[]
}

/** A guideline row as a GuidelineVersion; requirements in code order (R1, R2… R10). */
export function toGuidelineVersion(row: GuidelineVersionRow): GuidelineVersion {
  return {
    id: row.id,
    version: row.version,
    ...(row.issued_date ? { issuedDate: row.issued_date } : {}),
    effectiveDate: row.effective_date,
    fileName: row.file_name,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.added_by ? { addedById: row.added_by } : {}),
    addedAt: row.added_at,
    requirements: [...row.guideline_requirements]
      .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
      .map((item) => ({
        id: item.code,
        module: item.module,
        section: item.section,
        sectionTitle: item.section_title,
        shortTitle: item.short_title,
        page: item.page,
        summary: item.summary,
      })),
  }
}

/** Every guideline version, oldest first (the last one added is current). */
export async function fetchGuidelineVersions(): Promise<GuidelineVersion[]> {
  const { data, error } = await supabase().from('guideline_versions').select(GUIDELINE_COLUMNS).order('added_at')
  if (error) throw new Error(error.message)
  return (data as GuidelineVersionRow[]).map(toGuidelineVersion)
}

/** Starts a check of the SOP's current version against the current guideline; returns its id. */
export async function startComplianceCheck(sopId: string): Promise<string> {
  const { data, error } = await supabase().rpc('start_compliance_check', { p_sop_id: sopId })
  if (error) throw new Error(error.message)
  return data as string
}

/** SAMPLE ENGINE ONLY: finishes a running sample check, with the sample findings or as failed. */
export async function finishSampleCheck(checkId: string, outcome: 'completed' | 'failed'): Promise<void> {
  const { error } = await supabase().rpc('finish_sample_check', { p_check_id: checkId, p_outcome: outcome })
  if (error) throw new Error(error.message)
}
