import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ORGANIZATION_CHANGED, organizationEvents, saveDepartment } from './organizationAdmin'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: () => ({ rpc }) }))
beforeEach(() => vi.clearAllMocks())

describe('saveDepartment (save_department RPC)', () => {
  it('creates a department in its division with trimmed values and uppercase initials', async () => {
    rpc.mockResolvedValue({ data: 'department-1', error: null })
    expect(await saveDepartment({ name: ' Pharmacovigilance ', initials: ' pv ', description: ' Safety ', divisionId: 'medical' })).toBe('department-1')
    expect(rpc).toHaveBeenCalledWith('save_department', {
      p_id: null, p_name: 'Pharmacovigilance', p_initials: 'PV', p_description: 'Safety',
      p_division_id: 'medical', p_expected_updated_at: null,
    })
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
    [{ code: '40001', message: 'Organization changed; refresh and try again' }, 'Someone else changed this record. Refresh the page and try again.'],
    [{ code: '42501', message: 'Administrator required' }, 'Only an active administrator can manage divisions and departments.'],
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
