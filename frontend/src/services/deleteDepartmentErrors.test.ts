import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteDepartment } from './organizationAdmin'

/*
 * What an Admin is told when the delete-department Edge Function refuses (its JSON error body). A default
 * department (20261120120000) gets its own sentence; the other refusals keep theirs.
 */
const invoke = vi.fn()
vi.mock('./supabase', () => ({ supabase: () => ({ functions: { invoke }, rpc: vi.fn() }) }))

const refusal = (errorCode: string) => ({ data: null, error: { context: { json: async () => ({ errorCode }) } } })
const department = { id: 'pv', updated_at: 'r1', deletion_job_id: null }

beforeEach(() => invoke.mockReset())

describe('delete-department refusals', () => {
  it('a default department: "This is a default department and cannot be deleted."', async () => {
    invoke.mockResolvedValueOnce(refusal('default-department'))
    await expect(deleteDepartment(department, 'delete')).rejects.toThrow('This is a default department and cannot be deleted.')
    expect(invoke).toHaveBeenCalledWith('delete-department', { body: { departmentId: 'pv', expectedUpdatedAt: 'r1', confirmDeleteSops: true } })
  })

  it.each([
    ['employees-assigned', 'This department can’t be deleted because it has employees.'],
    ['conflict', 'Someone else changed this record. Refresh the page and try again.'],
    ['forbidden', 'Only an active Admin can manage divisions and departments.'],
  ])('%s keeps its message', async (code, message) => {
    invoke.mockResolvedValueOnce(refusal(code))
    await expect(deleteDepartment(department, 'delete')).rejects.toThrow(message)
  })
})
