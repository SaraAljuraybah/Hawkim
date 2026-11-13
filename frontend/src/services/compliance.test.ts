import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CheckAlreadyCompletedError } from '../lib/compliance'
import { CHECK_ALREADY_COMPLETED_HINT, fetchGuidelineRequirements, finishSampleCheck, startComplianceCheck, toGuidelineVersion, type GuidelineVersionRow } from './compliance'

const rpc = vi.fn()
// guideline_requirements reads: each call to range() returns the next page.
const pages: unknown[][] = []
const query = { select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), range: vi.fn(async () => ({ data: pages.shift() ?? [], error: null })) }
const from = vi.fn(() => query)
vi.mock('./supabase', () => ({ supabase: () => ({ rpc, from }) }))

beforeEach(() => {
  rpc.mockReset()
  query.range.mockClear()
  pages.length = 0
})

const requirement = (code: string) => ({
  code, module: 'Module I', section: 'I.B.10', section_title: 'Record management', short_title: 'Short ' + code, page: 22, summary: 'Summary ' + code,
})

describe('the GVP guideline from the database', () => {
  it('knows how many requirement passages a version has, without loading them', () => {
    const row: GuidelineVersionRow = {
      id: 'uuid-gvp', name: 'SFDA Guideline on Good Pharmacovigilance Practices (GVP)', version: '4.0', issued_date: '2015-05-27',
      effective_date: '2015-09-01', file_name: 'Drug-GVP4_0.pdf', added_by: null, added_at: '2026-10-26T09:00:00Z',
      source: null, storage_path: null, file_size: null,
      guideline_requirements: [{ count: 1505 }],
    }
    const version = toGuidelineVersion(row)
    expect(version).toMatchObject({
      id: 'uuid-gvp', title: 'SFDA Guideline on Good Pharmacovigilance Practices (GVP)', version: '4.0',
      issuedDate: '2015-05-27', effectiveDate: '2015-09-01', fileName: 'Drug-GVP4_0.pdf', addedAt: '2026-10-26T09:00:00Z',
    })
    expect(version.addedById).toBeUndefined()
    // No Summary of Changes; no Source or PDF recorded yet.
    expect(version).not.toHaveProperty('summary')
    expect(version.source).toBeUndefined()
    expect(version.storagePath).toBeUndefined()
    expect(version.requirements).toEqual([])
    expect(version.requirementCount).toBe(1505)
  })

  it("reads a version's passages in pages past the 1,000-row limit, in code order, keeping their code as their id", async () => {
    pages.push([...Array.from({ length: 999 }, (_, i) => requirement(`X${i + 3}`)), requirement('R10')], [requirement('R2'), requirement('R1')])
    const passages = await fetchGuidelineRequirements('uuid-gvp')
    expect(from).toHaveBeenCalledWith('guideline_requirements')
    expect(query.eq).toHaveBeenCalledWith('guideline_version_id', 'uuid-gvp')
    expect(query.range.mock.calls).toEqual([[0, 999], [1000, 1999]])
    expect(passages).toHaveLength(1002)
    expect(passages.slice(0, 3).map((item) => item.id)).toEqual(['R1', 'R2', 'R10'])
    expect(passages[0]).toEqual({ id: 'R1', module: 'Module I', section: 'I.B.10', sectionTitle: 'Record management', shortTitle: 'Short R1', page: 22, summary: 'Summary R1' })
  })
})

describe('a published version\'s source and PDF', () => {
  it('are read when recorded', () => {
    const version = toGuidelineVersion({
      id: 'uuid-gvp', name: 'GVP', version: '4.0', issued_date: null, effective_date: '2015-09-01', file_name: 'Drug-GVP4_0.pdf',
      added_by: null, added_at: '2026-10-26T09:00:00Z', source: 'https://www.sfda.gov.sa/gvp', storage_path: 'files/a.pdf', file_size: 2048,
      guideline_requirements: [],
    })
    expect(version).toMatchObject({ source: 'https://www.sfda.gov.sa/gvp', storagePath: 'files/a.pdf', fileSize: 2048, fileName: 'Drug-GVP4_0.pdf' })
    expect(version.neverCurrent).toBeUndefined()
  })
})

describe('running a sample check', () => {
  it('starts and finishes it through the database functions', async () => {
    rpc.mockResolvedValue({ data: 'uuid-check', error: null })
    expect(await startComplianceCheck('uuid-sop')).toBe('uuid-check')
    expect(rpc).toHaveBeenCalledWith('start_compliance_check', { p_sop_id: 'uuid-sop' })
    rpc.mockResolvedValue({ data: null, error: null })
    await finishSampleCheck('uuid-check', 'failed')
    expect(rpc).toHaveBeenCalledWith('finish_sample_check', { p_check_id: 'uuid-check', p_outcome: 'failed' })
  })

  it('reports when a check is already running', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'A compliance check is already running' } })
    await expect(startComplianceCheck('uuid-sop')).rejects.toThrow('already running')
  })

  it('recognises a refused repeat check by its hint, and only by that', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Any wording', code: '23514', hint: CHECK_ALREADY_COMPLETED_HINT } })
    await expect(startComplianceCheck('uuid-sop')).rejects.toBeInstanceOf(CheckAlreadyCompletedError)
    rpc.mockResolvedValue({ data: null, error: { message: 'Another refusal', code: '23514', hint: null } })
    await expect(startComplianceCheck('uuid-sop')).rejects.not.toBeInstanceOf(CheckAlreadyCompletedError)
  })
})
