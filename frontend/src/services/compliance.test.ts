import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finishSampleCheck, startComplianceCheck, toGuidelineVersion, type GuidelineVersionRow } from './compliance'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: () => ({ rpc }) }))

beforeEach(() => rpc.mockReset())

const requirement = (code: string) => ({
  code, module: 'Module I', section: 'I.B.10', section_title: 'Record management', short_title: 'Short ' + code, page: 22, summary: 'Summary ' + code,
})

describe('the GVP guideline from the database', () => {
  it('lists the requirements in code order and keeps their code as their id', () => {
    const row: GuidelineVersionRow = {
      id: 'uuid-gvp', version: '4.0', issued_date: '2015-05-27', effective_date: '2015-09-01', file_name: 'Drug-GVP4_0.pdf',
      summary: '', added_by: null, added_at: '2026-10-26T09:00:00Z',
      guideline_requirements: [requirement('R10'), requirement('R2'), requirement('R1')],
    }
    const version = toGuidelineVersion(row)
    expect(version).toMatchObject({ id: 'uuid-gvp', version: '4.0', issuedDate: '2015-05-27', effectiveDate: '2015-09-01', fileName: 'Drug-GVP4_0.pdf' })
    expect(version.addedById).toBeUndefined()
    expect(version.requirements.map((item) => item.id)).toEqual(['R1', 'R2', 'R10'])
    expect(version.requirements[0]).toEqual({ id: 'R1', module: 'Module I', section: 'I.B.10', sectionTitle: 'Record management', shortTitle: 'Short R1', page: 22, summary: 'Summary R1' })
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
})
