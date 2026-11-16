import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPeople, toUser, type ProfileRow } from './people'

/* fetchPeople marks the people whose tracked invitation isn't activated (get_unactivated_people). */

const query = { select: vi.fn(), order: vi.fn() }
let result: { data: unknown; error: { message: string } | null }
const from = vi.fn(() => query)
const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: () => ({ from, rpc }) }))

const row = (id: string): ProfileRow => ({
  id, full_name: `Person ${id}`, email: `${id}@example.test`, initials: 'PP', department_id: 'qa', phone: null, position: null,
  deleted_at: null, user_roles: [{ role: 'reviewer' }],
})

beforeEach(() => {
  vi.clearAllMocks()
  query.select.mockReturnValue(query)
  query.order.mockImplementation(async () => result)
  result = { data: [row('legacy'), row('waiting'), row('cancelled'), row('activated')], error: null }
})

describe('people and their invitations', () => {
  it('marks waiting and cancelled invitations; legacy and activated people are unchanged', async () => {
    rpc.mockResolvedValue({ data: [{ user_id: 'waiting', cancelled: false }, { user_id: 'cancelled', cancelled: true }], error: null })
    const people = await fetchPeople()
    expect(rpc).toHaveBeenCalledWith('get_unactivated_people')
    expect(people.map((person) => [person.id, person.invitation])).toEqual([
      ['legacy', undefined], ['waiting', 'pending'], ['cancelled', 'cancelled'], ['activated', undefined],
    ])
    expect(people[0]).toEqual(toUser(row('legacy')))
  })

  it('treats everyone as before when the list can’t be read', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    expect((await fetchPeople()).every((person) => person.invitation === undefined)).toBe(true)
    rpc.mockRejectedValue(new Error('offline'))
    expect((await fetchPeople()).every((person) => person.invitation === undefined)).toBe(true)
  })

  it('still fails when the people themselves can’t be read', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    result = { data: null, error: { message: 'connection lost' } }
    await expect(fetchPeople()).rejects.toThrow('connection lost')
  })
})
