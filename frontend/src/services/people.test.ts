import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchDepartments, fetchPeople, fetchProfile, toDepartment, toUser, updateUserDetails, UserDetailsError, type ProfileRow } from './people'

/** A query that resolves to `result` however it's narrowed (select, eq, order, maybeSingle). */
const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), maybeSingle: vi.fn() }
let result: { data: unknown; error: { message: string } | null }
const from = vi.fn(() => query)
const rpc = vi.fn()

vi.mock('./supabase', () => ({ supabase: () => ({ from, rpc }) }))

beforeEach(() => {
  vi.clearAllMocks()
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.order.mockImplementation(async () => result)
  query.maybeSingle.mockImplementation(async () => result)
})

const abeerRow: ProfileRow = {
  id: 'uuid-abeer', full_name: 'Abeer Alhamdan', email: 'abeer.alhamdan@hawkim.test', initials: 'AA',
  department_id: 'quality-assurance', phone: null, position: null, deleted_at: null, user_roles: [{ role: 'reviewer' }, { role: 'author' }],
}

describe('people from the database', () => {
  it('reads the phone number and position, and leaves them out when not set', async () => {
    const user = toUser({ ...abeerRow, phone: '+966500000009', position: 'QA Specialist' })
    expect(user.phone).toBe('+966500000009')
    expect(user.position).toBe('QA Specialist')
    expect(toUser(abeerRow)).not.toHaveProperty('phone')
    expect(toUser(abeerRow)).not.toHaveProperty('position')
    result = { data: [abeerRow], error: null }
    await fetchPeople()
    expect(query.select.mock.calls.at(-1)?.[0]).toContain('phone, position')
  })

  it('turns roles into permissions, in the usual order', () => {
    expect(toUser(abeerRow)).toEqual({
      id: 'uuid-abeer', name: 'Abeer Alhamdan', email: 'abeer.alhamdan@hawkim.test', initials: 'AA',
      departmentId: 'quality-assurance', permissions: ['author', 'reviewer'],
    })
  })

  it('shows a person without roles as an employee and keeps when a profile was ended', () => {
    const ended = toUser({ ...abeerRow, user_roles: [], deleted_at: '2026-10-20T09:00:00Z' })
    expect(ended.permissions).toEqual([])
    expect(ended.deletedAt).toBe('2026-10-20T09:00:00Z')
  })

  it('loads everyone, by name', async () => {
    result = { data: [abeerRow], error: null }
    expect(await fetchPeople()).toEqual([toUser(abeerRow)])
    expect(from).toHaveBeenCalledWith('profiles')
    expect(query.order).toHaveBeenCalledWith('full_name')
  })

  it('loads one profile, and nothing for an account without an active one', async () => {
    result = { data: abeerRow, error: null }
    expect(await fetchProfile('uuid-abeer')).toEqual(toUser(abeerRow))
    expect(query.eq).toHaveBeenCalledWith('id', 'uuid-abeer')
    result = { data: null, error: null }
    expect(await fetchProfile('uuid-new')).toBeNull()
    result = { data: { ...abeerRow, deleted_at: '2026-10-20T09:00:00Z' }, error: null }
    expect(await fetchProfile('uuid-abeer')).toBeNull()
  })

  it('throws when the database returns an error', async () => {
    result = { data: null, error: { message: 'connection lost' } }
    await expect(fetchPeople()).rejects.toThrow('connection lost')
  })
})

describe('departments from the database', () => {
  it('keeps when a department was removed', () => {
    expect(toDepartment({ id: 'legal-governance', name: 'Legal & Governance', initials: 'LG', description: '', is_quality: false, removed_at: '2026-10-01T09:00:00Z', requires_compliance_check: false }))
      .toEqual({ id: 'legal-governance', name: 'Legal & Governance', initials: 'LG', description: '', removedAt: '2026-10-01T09:00:00Z' })
  })

  it('loads every department, by name', async () => {
    result = { data: [{ id: 'quality-assurance', name: 'Quality Assurance', initials: 'QA', description: 'Quality.', is_quality: true, removed_at: null, requires_compliance_check: false }, { id: 'pharmacovigilance', name: 'Pharmacovigilance', initials: 'PV', description: '', is_quality: false, removed_at: null, requires_compliance_check: true }], error: null }
    expect(await fetchDepartments()).toEqual([
      { id: 'quality-assurance', name: 'Quality Assurance', initials: 'QA', description: 'Quality.', isQuality: true },
      { id: 'pharmacovigilance', name: 'Pharmacovigilance', initials: 'PV', description: '', requiresComplianceCheck: true },
    ])
    expect(from).toHaveBeenCalledWith('departments')
  })
})

describe('saving a user\'s details', () => {
  const details = { name: 'Rana Saleh', phone: '+966512345678', position: 'Specialist' }

  it('calls update_user_details and returns what the database saved', async () => {
    rpc.mockResolvedValue({ data: { ...details, initials: 'RS' }, error: null })
    await expect(updateUserDetails('uuid-rana', details)).resolves.toEqual({ ...details, initials: 'RS' })
    expect(rpc).toHaveBeenCalledWith('update_user_details', {
      p_user_id: 'uuid-rana', p_full_name: 'Rana Saleh', p_phone: '+966512345678', p_position: 'Specialist',
    })
  })

  it.each([
    ['42501', 'forbidden'],
    ['PGRST301', 'forbidden'],
    ['PGRST303', 'forbidden'],
    ['P0002', 'not-found'],
    ['23514', 'invalid'],
    // The migration isn't applied yet.
    ['PGRST202', 'failed'],
    ['', 'failed'],
  ])('reports the database error %s as %s', async (code, reason) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'refused' } })
    await expect(updateUserDetails('uuid-rana', details)).rejects.toMatchObject({ reason })
  })

  it('reports a network failure, and an unexpected reply, as failed', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(updateUserDetails('uuid-rana', details)).rejects.toBeInstanceOf(UserDetailsError)
    rpc.mockResolvedValue({ data: { name: 'Only a name' }, error: null })
    await expect(updateUserDetails('uuid-rana', details)).rejects.toMatchObject({ reason: 'failed' })
  })
})
