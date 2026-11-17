import { describe, expect, it, vi } from 'vitest'
import type { ManagementSnapshot } from '../services/organizationAdmin'
import { DEPARTMENT_FORM_FIELDS, departmentEmailProblem, departmentFormProblems, formInitials, initialDivisionId, submitDepartmentForm } from './departmentForm'

const snapshot: ManagementSnapshot = {
  divisions: [{ id: 'medical', name: 'Medical', description: '', email: null, updated_at: 'v1' }],
  departments: [
    { id: 'qa', name: 'Quality Assurance', initials: 'QA', description: '', division_id: 'medical', updated_at: 'r1', people: [], employees: 0, sops: 0, status_counts: {} },
    { id: 'legacy', name: 'Legacy', initials: 'LG', description: '', division_id: 'medical', updated_at: 'r1', people: [], employees: 0, sops: 0, status_counts: {} },
  ],
}
const values = { divisionId: 'medical', name: 'Pharmacovigilance', description: ' Safety ', email: 'pv@hawkim.test' }

describe('the division a department form starts with', () => {
  it('uses ?division only for a new department and only when it is an active division', () => {
    expect(initialDivisionId(snapshot, undefined, 'medical')).toBe('medical')
    expect(initialDivisionId(snapshot, undefined, 'removed-division')).toBe('')
    expect(initialDivisionId(snapshot, undefined, null)).toBe('')
  })
  it('keeps the edited department’s own division', () => {
    expect(initialDivisionId(snapshot, snapshot.departments[0], 'other')).toBe('medical')
  })
})

describe('department form problems', () => {
  it('has no Initials field: only division, name, description and email', () => {
    expect(DEPARTMENT_FORM_FIELDS).toEqual(['divisionId', 'name', 'description', 'email'])
  })
  it('accepts a valid new department in an active division', () => {
    expect(Object.values(departmentFormProblems(values, snapshot, {})).filter(Boolean)).toEqual([])
  })
  it('requires an active division for every department, new or edited (no "No Division")', () => {
    expect(departmentFormProblems({ ...values, divisionId: '' }, snapshot, {}).divisionId).toBe('division-required')
    expect(departmentFormProblems({ ...values, divisionId: 'gone' }, snapshot, {}).divisionId).toBe('division-required')
    expect(departmentFormProblems({ ...values, divisionId: '' }, snapshot, { editingId: 'legacy' }).divisionId).toBe('division-required')
    expect(departmentFormProblems(values, snapshot, { editingId: 'legacy' }).divisionId).toBeUndefined()
  })
  it('keeps the existing name and description rules against active departments', () => {
    const problems = departmentFormProblems({ divisionId: 'medical', name: 'quality assurance', description: 'x'.repeat(201), email: '' }, snapshot, {})
    expect(problems).toMatchObject({ name: 'name-taken', description: 'description-too-long' })
    expect(departmentFormProblems({ ...values, name: 'Quality Assurance' }, snapshot, { editingId: 'qa' }).name).toBeUndefined()
  })
  it('never reports an initials problem, even when the name’s abbreviation is already used', () => {
    const problems = departmentFormProblems({ ...values, name: 'Quality Audit' }, snapshot, {})
    expect(Object.values(problems).filter(Boolean)).toEqual([])
    expect(Object.keys(problems)).not.toContain('initials')
  })
  it('requires an email and a description: empty or only spaces is refused (as save_department does)', () => {
    for (const blank of ['', '   ', ' \n ']) {
      const problems = departmentFormProblems({ ...values, email: blank, description: blank }, snapshot, {})
      expect(problems, JSON.stringify(blank)).toMatchObject({ email: 'email-required', description: 'description-required' })
    }
  })
  it('reports an invalid email on the email field', () => {
    expect(departmentFormProblems({ ...values, email: 'not-an-email' }, snapshot, {}).email).toBe('email-invalid')
    expect(departmentFormProblems({ ...values, email: 'qa@hawkim.test' }, snapshot, {}).email).toBeUndefined()
  })
})

describe('the department email', () => {
  // Only the format: the form requires the email (departmentFormProblems: 'email-required').
  it('checks only the format: empty or only spaces is no format problem', () => {
    expect(departmentEmailProblem('')).toBeUndefined()
    expect(departmentEmailProblem('   ')).toBeUndefined()
  })
  it('accepts name@domain.tld, ignoring surrounding spaces', () => {
    expect(departmentEmailProblem('qa@hawkim.test')).toBeUndefined()
    expect(departmentEmailProblem('  first.last+qa@mail.hawkim.sa  ')).toBeUndefined()
  })
  it.each(['qa', 'qa@hawkim', '@hawkim.test', 'qa@.test', 'q a@hawkim.test', 'qa@hawkim.test@x', 'qa@hawkim.'])('refuses %s', (email) => {
    expect(departmentEmailProblem(email)).toBe('email-invalid')
  })
  it('allows up to 254 characters', () => {
    const domain = '@hawkim.test'
    expect(departmentEmailProblem('a'.repeat(254 - domain.length) + domain)).toBeUndefined()
    expect(departmentEmailProblem('a'.repeat(255 - domain.length) + domain)).toBe('email-invalid')
  })
  it('does not need to be unique', () => {
    const shared = { ...snapshot, departments: snapshot.departments.map((department) => ({ ...department, email: 'team@hawkim.test' })) }
    expect(departmentFormProblems({ ...values, email: 'team@hawkim.test' }, shared, {}).email).toBeUndefined()
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
    const result = await submitDepartmentForm(values, 'PH', { id: 'legacy' }, 'r1', { save, reload: async () => {} })
    expect(save).toHaveBeenCalledWith({ ...values, initials: 'PH', divisionId: 'medical' }, 'legacy', 'r1')
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
