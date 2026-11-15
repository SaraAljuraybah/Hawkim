import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchOrganization } from './organization'

const rpc = vi.hoisted(() => vi.fn())
// The divisions' descriptions (from the divisions table): none by default.
const descriptions = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: () => ({ rpc, from }) }))
beforeEach(() => {
  vi.clearAllMocks()
  descriptions.mockResolvedValue({ data: [], error: null })
  from.mockReturnValue({ select: descriptions })
})
/** The hierarchy as returned: each division with its description (null when none). */
const withDescriptions = <T extends { divisions: { id: string }[] }>(hierarchy: T, of: Record<string, string> = {}) =>
  ({ ...hierarchy, divisions: hierarchy.divisions.map((division) => ({ ...division, description: of[division.id] ?? null })) })

describe('persisted organizational structure', () => {
  it('uses the authenticated RPC and returns its actual records without substitution', async () => {
    const hierarchy = { organization: null, divisions: [], departments: [{ id: 'db-department', name: 'From database', divisionId: null, employees: [] }] }
    rpc.mockResolvedValue({ data: hierarchy, error: null })
    expect(await fetchOrganization()).toEqual(hierarchy)
    expect(rpc).toHaveBeenCalledWith('get_organizational_structure')
  })
  it('adds each division its description from the divisions table (null when none), never its email', async () => {
    const hierarchy = { organization: null, departments: [], divisions: [
      { id: 'ops', name: 'Operations', email: 'ops@test.invalid' }, { id: 'rnd', name: 'R&D', email: null }] }
    rpc.mockResolvedValue({ data: hierarchy, error: null })
    descriptions.mockResolvedValue({ data: [{ id: 'ops', description: 'Runs the sites' }, { id: 'rnd', description: null }], error: null })
    expect(await fetchOrganization()).toEqual(withDescriptions(hierarchy, { ops: 'Runs the sites' }))
    expect(from).toHaveBeenCalledWith('divisions')
    expect(descriptions).toHaveBeenCalledWith('id, description')
  })
  it('passes each employee’s phone number through (null when none) and rejects one that isn’t text', async () => {
    const person = (id: string, phone: unknown) => ({ id, name: id, initials: 'XX', email: `${id}@test.invalid`, position: null, phone, permissions: ['author'] })
    rpc.mockResolvedValue({ data: { organization: null, divisions: [], departments: [
      { id: 'qa', name: 'QA', divisionId: null, employees: [person('sara', '+966512345678'), person('omar', null)] }] }, error: null })
    const [qa] = (await fetchOrganization()).departments
    expect(qa.employees.map((employee) => employee.phone)).toEqual(['+966512345678', null])
    rpc.mockResolvedValue({ data: { organization: null, divisions: [], departments: [
      { id: 'qa', name: 'QA', divisionId: null, employees: [person('sara', 966512345678)] }] }, error: null })
    await expect(fetchOrganization()).rejects.toThrow('Invalid organizational structure')
  })
  it('fails rather than show the divisions without their descriptions', async () => {
    rpc.mockResolvedValue({ data: { organization: null, divisions: [], departments: [] }, error: null })
    descriptions.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    await expect(fetchOrganization()).rejects.toThrow('permission denied')
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
    expect(result).toEqual(withDescriptions(hierarchy))
    expect(result.divisions[0]).toEqual({ id, name, description: null })
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
    expect(await fetchOrganization()).toEqual(withDescriptions(hierarchy))
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
