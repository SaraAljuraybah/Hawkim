import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchManagement, managementError, ORGANIZATION_CHANGED, organizationEvents, saveDepartment, saveDivision } from './organizationAdmin'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: () => ({ rpc }) }))
beforeEach(() => vi.clearAllMocks())

describe('saveDepartment (save_department RPC)', () => {
  it('creates a department in its division with trimmed values and uppercase initials', async () => {
    rpc.mockResolvedValue({ data: 'department-1', error: null })
    expect(await saveDepartment({ name: ' Pharmacovigilance ', initials: ' pv ', description: ' Safety ', divisionId: 'medical' })).toBe('department-1')
    expect(rpc).toHaveBeenCalledWith('save_department', {
      p_id: null, p_name: 'Pharmacovigilance', p_initials: 'PV', p_description: 'Safety',
      p_division_id: 'medical', p_expected_updated_at: null, p_email: null,
    })
  })

  it('sends the email trimmed, and an empty email as none', async () => {
    rpc.mockResolvedValue({ data: 'qa', error: null })
    await saveDepartment({ name: 'QA', initials: 'QA', description: '', divisionId: 'medical', email: ' qa@hawkim.test ' }, 'qa', 'r1')
    expect(rpc).toHaveBeenLastCalledWith('save_department', expect.objectContaining({ p_email: 'qa@hawkim.test' }))
    await saveDepartment({ name: 'QA', initials: 'QA', description: '', divisionId: 'medical', email: '   ' }, 'qa', 'r1')
    expect(rpc).toHaveBeenLastCalledWith('save_department', expect.objectContaining({ p_email: null }))
  })

  it('edits with the department id and the expected version', async () => {
    rpc.mockResolvedValue({ data: 'qa', error: null })
    await saveDepartment({ name: 'QA', initials: 'QA', description: '', divisionId: null }, 'qa', 'r1')
    expect(rpc).toHaveBeenCalledWith('save_department', expect.objectContaining({ p_id: 'qa', p_division_id: null, p_expected_updated_at: 'r1' }))
  })

  it('announces the change so the hierarchy and the departments list reload', async () => {
    rpc.mockResolvedValue({ data: 'qa', error: null })
    const listener = vi.fn()
    organizationEvents.addEventListener(ORGANIZATION_CHANGED, listener)
    await saveDepartment({ name: 'QA', initials: 'QA', description: '', divisionId: 'medical' }, 'qa', 'r1')
    organizationEvents.removeEventListener(ORGANIZATION_CHANGED, listener)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ code: '23505', message: 'Department name or initials already exists' }, 'That name is already in use, or another change was saved at the same time. Refresh the page and try again.'],
    [{ code: 'P0001', hint: 'conflict', message: 'Organization changed; refresh and try again' }, 'Someone else changed this record. Refresh the page and try again.'],
    [{ code: '40001', message: 'Organization changed; refresh and try again' }, 'Someone else changed this record. Refresh the page and try again.'],
    [{ code: '42501', message: 'Administrator required' }, 'Only an active Admin can manage divisions and departments.'],
    [{ code: '23514', message: 'Select an active division' }, 'Select a division.'],
    [{ code: '23514', message: 'Department file cleanup is pending' }, 'File cleanup for this department is still in progress. Use Retry file cleanup to finish it.'],
  ])('turns the refusal %o into what the admin should do next, without announcing a change', async (error, message) => {
    rpc.mockResolvedValue({ data: null, error })
    const listener = vi.fn()
    organizationEvents.addEventListener(ORGANIZATION_CHANGED, listener)
    await expect(saveDepartment({ name: 'QA', initials: 'QA', description: '', divisionId: 'medical' })).rejects.toThrow(message)
    organizationEvents.removeEventListener(ORGANIZATION_CHANGED, listener)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('fetchManagement (department email)', () => {
  const department = { id: 'qa', name: 'QA', initials: 'QA', description: '', division_id: null, updated_at: 'r1',
    people: [], employees: 0, sops: 0, status_counts: {} }
  it.each([['an email', { email: 'qa@hawkim.test' }], ['no email', { email: null }], ['no email column yet', {}]])('accepts a department with %s', async (_, email) => {
    rpc.mockResolvedValue({ data: { divisions: [], departments: [{ ...department, ...email }] }, error: null })
    expect((await fetchManagement()).departments).toHaveLength(1)
  })
  it('refuses a snapshot whose department email is not text', async () => {
    rpc.mockResolvedValue({ data: { divisions: [], departments: [{ ...department, email: 42 }] }, error: null })
    await expect(fetchManagement()).rejects.toThrow()
  })
})

describe('managementError (a division name already in use)', () => {
  const exists = 'A division with this name already exists. Please choose a different name.'
  it.each([
    ['save_division’s own refusal', { code: '23505', message: 'Division name already exists' }],
    ['the per-organization unique index (a save that raced past the check)', { code: '23505', message: 'duplicate key value violates unique constraint "divisions_organization_name_unique"' }],
    ['the older global unique index', { code: '23505', message: 'duplicate key value violates unique constraint "divisions_name_unique"' }],
  ])('names the clash for %s', (_, error) => {
    expect(managementError(error).message).toBe(exists)
  })
  it.each([
    ['a department’s name or initials', { code: '23505', message: 'Department name or initials already exists' }],
    ['another unique index', { code: '23505', message: 'duplicate key value violates unique constraint "divisions_pkey"' }],
    ['a 23505 with no message', { code: '23505' }],
  ])('keeps the general message for %s', (_, error) => {
    expect(managementError(error).message).toBe('That name is already in use, or another change was saved at the same time. Refresh the page and try again.')
  })
  it('never treats the division message under another code as a name clash', () => {
    expect(managementError({ code: '23514', message: 'Division name already exists' }).message).toBe('Check the fields and try again.')
    expect(managementError({ code: 'P0001', hint: 'conflict', message: 'Division name already exists' }).message).toBe('Someone else changed this record. Refresh the page and try again.')
  })
  it('saves the trimmed name, and turns save_division’s refusal into the name message', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'Division name already exists' } })
    await expect(saveDivision({ name: '  safety  ', description: 'd', email: 'a@b.co' })).rejects.toThrow(exists)
    expect(rpc).toHaveBeenLastCalledWith('save_division', expect.objectContaining({ p_name: 'safety' }))
  })
})
