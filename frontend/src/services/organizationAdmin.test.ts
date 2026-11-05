import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteDepartment, deleteDivision, fetchManagement, managementError, organizationEvents, ORGANIZATION_CHANGED, saveDepartment, saveDivision, setEmployeePositions } from './organizationAdmin'
const { rpc, invoke } = vi.hoisted(() => ({ rpc:vi.fn(),invoke:vi.fn() }))
vi.mock('./supabase', () => ({ supabase: () => ({ rpc,functions:{invoke} }) }))
beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: 'saved-id', error: null }); invoke.mockResolvedValue({data:{state:'completed'},error:null}) })
const division = { id: 'v', name: 'Division', email: 'd@test.invalid', description: '', updated_at: '2026-11-01T00:00:00Z' }
describe('employee positions', () => {
  const person = { id:'p', name:'Sara', email:'s@test.invalid', initials:'SA', departmentId:'d', permissions:['author'], positions:['Safety Officer','QPPV Deputy'] }
  const department = { id:'d', name:'PV', initials:'PV', description:'', division_id:'v', updated_at:'r', employees:1, sops:0, status_counts:{}, people:[person] }
  it('accepts several positions per employee and server division totals', async () => {
    const data = { divisions: [{ ...division, department_count: 1, employees: 1, sops: 0 }], departments: [department] }
    rpc.mockResolvedValue({ data, error: null })
    expect((await fetchManagement()).departments[0].people?.[0].positions).toEqual(['Safety Officer','QPPV Deputy'])
  })
  it.each([[{ ...person, positions: 'Officer' }], [{ ...person, positions: [''] }], [{ ...person, positions: undefined }]])('rejects malformed positions', async (bad) => {
    rpc.mockResolvedValue({ data: { divisions: [division], departments: [{ ...department, people: [bad] }] }, error: null })
    await expect(fetchManagement()).rejects.toThrow('load')
  })
  it('saves trimmed, non-empty positions through the admin RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await setEmployeePositions('p', [' Safety Officer ', '', 'QPPV Deputy'])
    expect(rpc).toHaveBeenCalledWith('set_employee_positions', { p_profile_id: 'p', p_titles: ['Safety Officer', 'QPPV Deputy'] })
  })
  it('explains the required-position rule', () => {
    expect(managementError({ code: '23514', message: 'A position is required for a department assignment' }).message).toMatch('at least one position')
  })
})
describe('organization management RPC contract', () => {
  it('reads one authoritative snapshot', async () => {
    const data = { divisions: [division], departments: [] }
    rpc.mockResolvedValue({ data, error: null })
    expect(await fetchManagement()).toBe(data)
    expect(rpc).toHaveBeenCalledWith('get_divisions_departments', undefined)
  })
  it('rejects missing data rather than inventing records', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(fetchManagement()).rejects.toThrow('load')
  })
  it.each([
    { divisions: [null], departments: [] },
    { divisions: [], departments: [{ id:'d', employees:'5' }] },
    { divisions: [division,division], departments: [] },
  ])('rejects malformed nested snapshots', async (data) => {
    rpc.mockResolvedValue({ data,error:null })
    await expect(fetchManagement()).rejects.toThrow('load')
  })
  it('creates a division with normalized input and no client-provided identity', async () => {
    await saveDivision({ name: ' New ', description: ' Description ', email: ' mail@test.invalid ' })
    expect(rpc).toHaveBeenCalledWith('save_division', { p_id: null, p_name: 'New', p_description: 'Description', p_email: 'mail@test.invalid', p_expected_updated_at: null })
  })
  it('edits through the same RPC with an optimistic concurrency token', async () => {
    await saveDivision({ name: 'Edited', description: '', email: 'e@test.invalid' }, division)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_id: 'v', p_expected_updated_at: division.updated_at })
  })
  it('binds new departments to the clicked division', async () => {
    await saveDepartment({ name: ' Dept ', initials: ' dp ', description: ' Work ', divisionId: 'v' })
    expect(rpc).toHaveBeenCalledWith('save_department', { p_id: null, p_name: 'Dept', p_initials: 'DP', p_description: 'Work', p_division_id: 'v', p_expected_updated_at: null })
  })
  it('passes both the selected division and the previous revision on a department move', async () => {
    await saveDepartment({ name: 'Dept', initials: 'DP', description: '', divisionId: 'other' }, 'dept', 'revision')
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_id: 'dept', p_division_id: 'other', p_expected_updated_at: 'revision' })
  })
  it.each(['empty','others'] as const)('deletes atomically with explicit disposition %s', async (action) => {
    await deleteDepartment({ id: 'dept', updated_at: 'revision' }, action)
    expect(rpc).toHaveBeenCalledWith('delete_department', { p_id: 'dept', p_sop_action: action, p_expected_updated_at: 'revision' })
  })
  it('permanently deletes files through the authenticated Edge Function', async () => {
    await deleteDepartment({id:'dept',updated_at:'revision'},'delete')
    expect(invoke).toHaveBeenCalledWith('delete-department',{body:{departmentId:'dept',expectedUpdatedAt:'revision',confirmDeleteSops:true}})
    expect(rpc).not.toHaveBeenCalled()
  })
  it('continues batches using the durable job ID until completion', async () => {
    invoke.mockResolvedValueOnce({data:{state:'pending',jobId:'job'},error:null}).mockResolvedValueOnce({data:{state:'completed'},error:null})
    await deleteDepartment({id:'dept',updated_at:'revision'},'delete')
    expect(invoke.mock.calls[1][1]).toEqual({body:{jobId:'job'}})
  })
  it('resumes pending cleanup without creating a second destructive intent', async () => {
    await deleteDepartment({id:'dept',updated_at:'revision',deletion_job_id:'job'},'empty')
    expect(invoke.mock.calls[0][1]).toEqual({body:{jobId:'job'}})
  })
  it.each(['busy','failed'])('never reports %s cleanup as successful deletion', async (state) => {
    invoke.mockResolvedValue({data:{state,jobId:'job'},error: state==='failed' ? {context:new Response(JSON.stringify({state}))} : null})
    await expect(deleteDepartment({id:'dept',updated_at:'revision'},'delete')).rejects.toThrow('cleanup')
  })
  it('reports unavailable cleanup service without exposing internal diagnostics', async () => {
    invoke.mockRejectedValue(new Error('secret internal diagnostic'))
    await expect(deleteDepartment({id:'dept',updated_at:'revision'},'delete')).rejects.toThrow('cleanup is incomplete')
  })
  it('deletes an empty division with its revision', async () => {
    await deleteDivision(division)
    expect(rpc).toHaveBeenCalledWith('delete_division', { p_id: 'v', p_expected_updated_at: division.updated_at })
  })
  it('refreshes shared consumers only after a committed mutation', async () => {
    const notify = vi.fn(); organizationEvents.addEventListener(ORGANIZATION_CHANGED, notify)
    try {
      await deleteDivision(division); expect(notify).toHaveBeenCalledOnce()
      rpc.mockResolvedValue({ data: null, error: { code: '40001' } })
      await expect(deleteDivision(division)).rejects.toThrow('changed')
      expect(notify).toHaveBeenCalledOnce()
    } finally { organizationEvents.removeEventListener(ORGANIZATION_CHANGED, notify) }
  })
  it.each([['42501','administrator'],['40001','changed'],['23505','in use'],['23514','fields'],['XX000','try again']])('sanitizes database errors %s', (code, message) => {
    const error = managementError({ code, message: 'sensitive internal table name' })
    expect(error.message.toLowerCase()).toContain(message)
    expect(error.message).not.toContain('sensitive')
  })
})
