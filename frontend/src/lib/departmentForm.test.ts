import { describe, expect, it, vi } from 'vitest'
import type { ManagementSnapshot } from '../services/organizationAdmin'
import { DEPARTMENT_FORM_FIELDS, departmentFormProblems, divisionIsOptional, formInitials, initialDivisionId, submitDepartmentForm } from './departmentForm'

const snapshot: ManagementSnapshot = {
  divisions: [{ id: 'medical', name: 'Medical', description: '', email: null, updated_at: 'v1' }],
  departments: [
    { id: 'qa', name: 'Quality Assurance', initials: 'QA', description: '', division_id: 'medical', updated_at: 'r1', people: [], employees: 0, sops: 0, status_counts: {} },
    { id: 'legacy', name: 'Legacy', initials: 'LG', description: '', division_id: null, updated_at: 'r1', people: [], employees: 0, sops: 0, status_counts: {} },
  ],
}
const values = { divisionId: 'medical', name: 'Pharmacovigilance', description: ' Safety ' }

describe('the division a department form starts with', () => {
  it('uses ?division only for a new department and only when it is an active division', () => {
    expect(initialDivisionId(snapshot, undefined, 'medical')).toBe('medical')
    expect(initialDivisionId(snapshot, undefined, 'removed-division')).toBe('')
    expect(initialDivisionId(snapshot, undefined, null)).toBe('')
  })
  it('keeps the edited department’s own division (or none for a legacy one)', () => {
    expect(initialDivisionId(snapshot, snapshot.departments[0], 'other')).toBe('medical')
    expect(initialDivisionId(snapshot, snapshot.departments[1], 'medical')).toBe('')
  })
  it('makes the division optional only for an existing department that has none', () => {
    expect(divisionIsOptional(undefined)).toBe(false)
    expect(divisionIsOptional(snapshot.departments[0])).toBe(false)
    expect(divisionIsOptional(snapshot.departments[1])).toBe(true)
  })
})

describe('department form problems', () => {
  it('has no Initials field: only division, name and description', () => {
    expect(DEPARTMENT_FORM_FIELDS).toEqual(['divisionId', 'name', 'description'])
  })
  it('accepts a valid new department in an active division', () => {
    expect(Object.values(departmentFormProblems(values, snapshot, { divisionOptional: false })).filter(Boolean)).toEqual([])
  })
  it('requires a division for a new department, and an active one when chosen', () => {
    expect(departmentFormProblems({ ...values, divisionId: '' }, snapshot, { divisionOptional: false }).divisionId).toBe('division-required')
    expect(departmentFormProblems({ ...values, divisionId: 'gone' }, snapshot, { divisionOptional: true }).divisionId).toBe('division-required')
    expect(departmentFormProblems({ ...values, divisionId: '' }, snapshot, { editingId: 'legacy', divisionOptional: true }).divisionId).toBeUndefined()
  })
  it('keeps the existing name and description rules against active departments', () => {
    const problems = departmentFormProblems({ divisionId: 'medical', name: 'quality assurance', description: 'x'.repeat(201) }, snapshot, { divisionOptional: false })
    expect(problems).toMatchObject({ name: 'name-taken', description: 'description-too-long' })
    expect(departmentFormProblems({ ...values, name: 'Quality Assurance' }, snapshot, { editingId: 'qa', divisionOptional: false }).name).toBeUndefined()
  })
  it('never reports an initials problem, even when the name’s abbreviation is already used', () => {
    const problems = departmentFormProblems({ ...values, name: 'Quality Audit' }, snapshot, { divisionOptional: false })
    expect(Object.values(problems).filter(Boolean)).toEqual([])
    expect(Object.keys(problems)).not.toContain('initials')
  })
})

describe('the initials saved with the form', () => {
  it('are generated from the name', () => {
    expect(formInitials({ name: 'Research & Development' }, snapshot)).toBe('RD')
  })
  it('never reuse another department’s initials (QA is taken, so a 3-letter variant)', () => {
    expect(formInitials({ name: 'Quality Audit' }, snapshot)).toBe('QAU')
  })
  it('keep an edited department’s own initials while its name is unchanged', () => {
    expect(formInitials({ name: 'Legacy' }, snapshot, snapshot.departments[1])).toBe('LG')
  })
  it('follow a rename', () => {
    expect(formInitials({ name: 'Regulatory Affairs' }, snapshot, snapshot.departments[1])).toBe('RA')
  })
})

describe('submitting the department form', () => {
  it('creates through the RPC with the division and the generated initials, then reloads before opening the page', async () => {
    const calls: string[] = []
    const save = vi.fn(async () => { calls.push('save'); return 'department-new' })
    const reload = vi.fn(async () => { calls.push('reload') })
    expect(await submitDepartmentForm(values, 'PH', undefined, undefined, { save, reload })).toEqual({ targetId: 'department-new', state: { notice: 'added' } })
    expect(save).toHaveBeenCalledWith({ ...values, initials: 'PH', divisionId: 'medical' }, undefined, undefined)
    expect(calls).toEqual(['save', 'reload'])
  })
  it('edits with the department id and the version it started from', async () => {
    const save = vi.fn(async () => 'qa')
    const result = await submitDepartmentForm({ ...values, divisionId: '' }, 'PH', { id: 'legacy' }, 'r1', { save, reload: async () => {} })
    expect(save).toHaveBeenCalledWith({ ...values, initials: 'PH', divisionId: null }, 'legacy', 'r1')
    expect(result.state).toEqual({ notice: 'updated' })
  })
  it('reports a refused save without reloading', async () => {
    const reload = vi.fn()
    await expect(submitDepartmentForm(values, 'PH', undefined, undefined, { save: async () => { throw new Error('That name is already in use.') }, reload }))
      .rejects.toThrow('That name is already in use.')
    expect(reload).not.toHaveBeenCalled()
  })
  it('still opens the saved department when only the reload fails', async () => {
    const result = await submitDepartmentForm(values, 'PH', undefined, undefined, { save: async () => 'department-new', reload: async () => { throw new Error('offline') } })
    expect(result.targetId).toBe('department-new')
  })
})
