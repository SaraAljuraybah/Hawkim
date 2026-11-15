import { describe, expect, it, vi } from 'vitest'
import type { GuidelineVersion, Sop } from '../data/mock/types'
import { sops } from '../data/mock/sops'
import { hasCurrentCheck } from './compliance'
import { guidelineGate } from './guidelineGate'
import { currentVersion, newestVersion, recheckRecommended } from './guidelines'
import { departmentDeleteBlocker, isDefaultDepartment } from './organizationAdmin'
import { emptyRequestValues, prefillFromParams } from './requestPrefill'
import { requestGuidelineAdditionPath } from './routes'

const v40: GuidelineVersion = { id: 'gvp-4-0', title: 'SFDA GVP', version: '4.0', effectiveDate: '2015-09-01', fileName: 'gvp.pdf', requirements: [] }
const checkedSop: Sop = {
  ...sops[0], status: 'draft', version: '1',
  complianceChecks: [{ id: 'c1', sopId: sops[0].id, version: '1', guideline: { name: 'GVP', version: '4.0' }, status: 'completed', startedAt: '2026-11-01T08:00:00Z', triggeredById: 'author', findings: [] }],
}

describe('an organization without a regulatory guideline (a new one starts with none)', () => {
  it('has no current version: never a stand-in', () => {
    expect(currentVersion([])).toBeUndefined()
    expect(currentVersion([v40])).toBe(v40)
    expect(newestVersion([], undefined)).toBeUndefined()
    expect(newestVersion([{ ...v40, id: 'added', neverCurrent: true }], undefined)).toBeUndefined()
  })

  it('has no current check and recommends no recheck', () => {
    expect(hasCurrentCheck(checkedSop, undefined)).toBe(false)
    expect(hasCurrentCheck(checkedSop, '4.0')).toBe(true)
    expect(recheckRecommended(checkedSop, undefined)).toBe(false)
    expect(recheckRecommended(checkedSop, '4.1')).toBe(true)
  })
})

describe('Check Compliance first asks whether a guideline exists (guidelineGate)', () => {
  it('with a current guideline: starts the check as before, without asking', async () => {
    const read = vi.fn()
    expect(await guidelineGate(true, read, vi.fn())).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  it.each(['none', 'processing', 'failed', 'unpublished', 'cancelled'] as const)('without one: %s is the reason, and no check starts', async (state) => {
    const refresh = vi.fn()
    expect(await guidelineGate(false, async () => state, refresh)).toBe(state)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('a failed read is an error, never "no guideline"', async () => {
    expect(await guidelineGate(false, async () => { throw new Error('offline') }, vi.fn())).toBe('error')
  })

  it('one published since the page loaded: reads the guidelines again, then checks as usual', async () => {
    const refresh = vi.fn(async () => {})
    expect(await guidelineGate(false, async () => 'available', refresh)).toBeNull()
    expect(refresh).toHaveBeenCalledOnce()
  })
})

describe('Regulatory Guideline Addition, from the missing-guideline dialog', () => {
  const types = ['department-access', 'permission-change', 'role-change', 'regulatory-guideline-addition'] as const

  it('links to Submit a Request with the type chosen and the SOP', () => {
    expect(requestGuidelineAdditionPath('sop-1')).toBe('/requests/new?type=regulatory-guideline-addition&sop=sop-1')
    expect(requestGuidelineAdditionPath()).toBe('/requests/new?type=regulatory-guideline-addition')
  })

  it('starts with the type, a title and a description (naming the SOP), and no department', () => {
    const params = new URLSearchParams(requestGuidelineAdditionPath('sop-1').split('?')[1])
    const values = prefillFromParams(params, [...types], ['quality-assurance'], { title: 'PV Signal Handling' })
    expect(values.type).toBe('regulatory-guideline-addition')
    expect(values.title).toBe('Request to Add a Regulatory Guideline')
    expect(values.description).toContain('no regulatory guideline available for compliance checking')
    expect(values.description).toContain('“PV Signal Handling”')
    expect(values.departmentId).toBe('')
    expect(prefillFromParams(params, [...types], [], undefined).description).not.toContain('“')
  })

  it('other prefills are unchanged, and unknown types are ignored', () => {
    expect(prefillFromParams(new URLSearchParams('type=department-access&department=qa'), [...types], ['qa']))
      .toEqual({ ...emptyRequestValues, type: 'department-access', departmentId: 'qa' })
    expect(prefillFromParams(new URLSearchParams('type=made-up'), [...types], [])).toEqual(emptyRequestValues)
  })
})

describe('default departments (Pharmacovigilance, Quality Assurance)', () => {
  const department = (system_key: string | null, employees = 0, sops = 0) => ({ employees, sops, deletion_job_id: null, system_key })

  it('can never be deleted, whatever else is true', () => {
    expect(departmentDeleteBlocker(department('pharmacovigilance'))).toBe('default')
    expect(departmentDeleteBlocker(department('quality-assurance', 3, 2))).toBe('default')
    expect(isDefaultDepartment({ system_key: 'quality-assurance' })).toBe(true)
  })

  it('other departments keep their rules', () => {
    expect(departmentDeleteBlocker(department(null))).toBeUndefined()
    expect(departmentDeleteBlocker(department(null, 1))).toBe('employees')
    expect(departmentDeleteBlocker(department(null, 0, 1))).toBe('sops')
    expect(isDefaultDepartment({ system_key: null })).toBe(false)
    expect(isDefaultDepartment({})).toBe(false)
  })
})
