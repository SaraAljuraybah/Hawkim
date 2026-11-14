import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchOrganization } from './organization'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: () => ({ rpc }) }))
beforeEach(() => vi.clearAllMocks())

describe('persisted organizational structure', () => {
  it('uses the authenticated RPC and returns its actual records without substitution', async () => {
    const hierarchy = { organization: null, divisions: [], departments: [{ id: 'db-department', name: 'From database', divisionId: null, employees: [] }] }
    rpc.mockResolvedValue({ data: hierarchy, error: null })
    expect(await fetchOrganization()).toEqual(hierarchy)
    expect(rpc).toHaveBeenCalledWith('get_organizational_structure')
  })
  it('lists no Admin in a department: Admins belong to none, whatever their account still holds', async () => {
    const person = (id: string, permissions: string[]) => ({ id, name: id, initials: 'XX', email: `${id}@test.invalid`, position: 'Title', permissions })
    rpc.mockResolvedValue({ data: { organization: null, divisions: [], departments: [
      { id: 'qa', name: 'QA', divisionId: null, employees: [person('admin', ['admin']), person('sara', ['author']), person('both', ['admin', 'reviewer'])] },
    ] }, error: null })
    const [qa] = (await fetchOrganization()).departments
    expect(qa.employees.map((employee) => employee.id)).toEqual(['sara'])
  })
  it('propagates authorization and network errors without fabricated data', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    await expect(fetchOrganization()).rejects.toThrow('permission denied')
  })
  it.each([
    ['rnd', 'Clinical Research and Development'],
    ['governance_quality_compliance', 'Quality and Compliance'],
  ])('passes the persisted division name through unchanged for %s', async (id, name) => {
    const hierarchy = { organization: null, divisions: [{ id, name }], departments: [] }
    rpc.mockResolvedValue({ data: hierarchy, error: null })
    const result = await fetchOrganization()
    expect(result).toEqual(hierarchy)
    expect(result.divisions[0]).toEqual({ id, name })
  })
  it('rejects missing or malformed responses', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(fetchOrganization()).rejects.toThrow('Invalid organizational structure')
  })
  it('accepts nullable positions and preserves all real permissions and underscore division IDs', async () => {
    const hierarchy = { organization: null, divisions: [{ id: 'regulatory_drug_safety', name: 'Configured name' }], departments: [
      { id: 'department', name: 'Department', divisionId: 'regulatory_drug_safety', employees: [
        { id: 'employee', name: 'Stored name', initials: 'SN', email: 'stored@test.invalid', position: null, permissions: ['author', 'reviewer'] },
      ] },
    ] }
    rpc.mockResolvedValue({ data: hierarchy, error: null })
    expect(await fetchOrganization()).toEqual(hierarchy)
  })
  it.each([
    { organization: undefined, divisions: [], departments: [] },
    { organization: null, divisions: [null], departments: [] },
    { organization: null, divisions: [], departments: [{ id: 'd', name: 'D', divisionId: null, employees: null }] },
    ...[null, { id: 'u', name: 'U', initials: 'U', email: 'u@test.invalid', position: 123, permissions: [] },
      { id: 'u', name: 'U', initials: 'U', email: 'u@test.invalid', permissions: ['invented-role'] },
      { id: 'u', name: 'U', initials: 'U', email: 'u@test.invalid', permissions: ['admin', 'admin'] },
      // Every employee carries an email.
      { id: 'u', name: 'U', initials: 'U', permissions: [] },
      { id: 'u', name: 'U', initials: 'U', email: null, permissions: [] }].map((employee) => ({ organization: null, divisions: [], departments: [{ id: 'd', name: 'D', divisionId: null, employees: [employee] }] })),
  ])('rejects an invalid nested response: %j', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(fetchOrganization()).rejects.toThrow('Invalid organizational structure')
  })
  it('rejects duplicate employee memberships instead of displaying false counts', async () => {
    const employee = { id: 'u', name: 'U', initials: 'U', email: 'u@test.invalid', permissions: [] }
    rpc.mockResolvedValue({ data: { organization: null, divisions: [], departments: ['a', 'b'].map((id) => ({ id, name: id, divisionId: null, employees: [employee] })) }, error: null })
    await expect(fetchOrganization()).rejects.toThrow('Invalid organizational structure')
  })
})
