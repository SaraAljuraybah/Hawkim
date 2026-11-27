import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchManagement, managementError, ORGANIZATION_CHANGED, organizationEvents, saveDepartment, saveDivision } from './organizationAdmin'
import { DuplicateNameError } from '../lib/duplicateNameError'

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
    // The latest list can't be read here (every call is refused), so the name message, as the database said.
    [{ code: '23505', message: 'Department name or initials already exists' }, 'A department with this name already exists. Please choose a different name.'],
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

describe('a name already used (23505), apart from a save at the same time (conflict)', () => {
  const snapshotWith = (names: string[]) => ({ divisions: [{ id: 'medical', name: 'Medical', description: '', email: null, updated_at: 'v1' }],
    departments: names.map((name, index) => ({ id: `d${index}`, name, initials: `D${'ABC'[index]}`, description: '', division_id: 'medical',
      updated_at: 'r1', people: [], employees: 0, sops: 0, status_counts: {} })) })
  const refusedSave = (snapshot: unknown) => rpc.mockImplementation(async (name: string) => name === 'save_department'
    ? { data: null, error: { code: '23505', message: 'Department name or initials already exists' } }
    : { data: snapshot, error: null })

  it('says a division with this name exists, as a DuplicateNameError for the Name field', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'Division name already exists' } })
    const refusal = saveDivision({ name: 'Safety', description: 'd', email: 'a@b.co' })
    await expect(refusal).rejects.toBeInstanceOf(DuplicateNameError)
    await expect(refusal).rejects.toThrow('A division with this name already exists. Please choose a different name.')
  })

  it('says a department with this name exists when the latest list has it (ignoring case and spaces)', async () => {
    refusedSave(snapshotWith(['Quality Assurance']))
    const refusal = saveDepartment({ name: ' quality assurance ', initials: 'QAS', description: '', divisionId: 'medical' })
    await expect(refusal).rejects.toBeInstanceOf(DuplicateNameError)
    await expect(refusal).rejects.toThrow('A department with this name already exists. Please choose a different name.')
  })

  it('reports a save at the same time when the name is free in the latest list (the generated initials were taken)', async () => {
    refusedSave(snapshotWith(['Clinical Operations']))
    await expect(saveDepartment({ name: 'Quality Assurance', initials: 'QA', description: '', divisionId: 'medical' }))
      .rejects.toThrow('Someone else changed this record. Refresh the page and try again.')
  })

  it("doesn't count the edited department's own name", async () => {
    refusedSave(snapshotWith(['Quality Assurance']))
    await expect(saveDepartment({ name: 'Quality Assurance', initials: 'QA', description: '', divisionId: 'medical' }, 'd0', 'r1'))
      .rejects.toThrow('Someone else changed this record. Refresh the page and try again.')
  })

  it('keeps the conflict message for a stale edit', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', hint: 'conflict', message: 'Organization changed; refresh and try again' } })
    await expect(saveDivision({ name: 'Safety', description: 'd', email: 'a@b.co' }, { id: 'v', name: 'Safety', description: 'd', email: 'a@b.co', updated_at: 'old' }))
      .rejects.toThrow('Someone else changed this record. Refresh the page and try again.')
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
  it('names a department name clash as a department one', () => {
    expect(managementError({ code: '23505', message: 'Department name or initials already exists' }).message)
      .toBe('A department with this name already exists. Please choose a different name.')
  })
  it.each([
    ['another unique index', { code: '23505', message: 'duplicate key value violates unique constraint "divisions_pkey"' }],
    ['a 23505 with no message', { code: '23505' }],
  ])('never calls %s a name clash: the general save message', (_, error) => {
    expect(managementError(error)).not.toBeInstanceOf(DuplicateNameError)
    expect(managementError(error).message).toBe('Could not save changes. Try again.')
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
