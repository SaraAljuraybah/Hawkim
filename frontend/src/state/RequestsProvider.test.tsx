import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Department, User, UserRequest } from '../data/mock/types'
import { getDirectoryDepartments, getUserDepartments } from '../lib/departments'
import { pendingRequests } from '../lib/requestAdmin'
import { RequestsProvider } from './RequestsProvider'
import { useRequests, type RequestsStore } from './requestsContext'

const fixture = vi.hoisted(() => ({
  user: null as User | null,
  users: [] as User[],
  requests: [] as UserRequest[],
  departments: ['home', 'a', 'b', 'c'].map((id) => ({ id, name: id, initials: id, description: '' })) as Department[],
  commit: vi.fn<(requests: UserRequest[]) => void>(),
}))

// Observe real provider commits without adding a browser test environment.
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useState: (initial: UserRequest[]) => {
      const [state, setState] = react.useState(initial)
      return [state, (next: UserRequest[]) => { fixture.commit(next); setState(next) }] as const
    },
  }
})
vi.mock('../data/mock/requests', () => ({ mockRequests: fixture.requests }))
vi.mock('./sessionContext', () => ({ useSession: () => ({ user: fixture.user }) }))
vi.mock('./usersContext', () => ({ useUsers: () => ({ users: fixture.users }) }))
vi.mock('./departmentsContext', () => ({ useDepartments: () => ({ departments: fixture.departments }) }))

function person(id: string, permissions: User['permissions'] = []): User {
  return { id, name: id, email: id + '@example.test', initials: 'TT', departmentId: 'home', permissions }
}

function request(overrides: Partial<UserRequest> = {}): UserRequest {
  return { id: 'request', title: 'Directory access', type: 'department-access', departmentId: 'a', description: 'Original request', createdAt: '2026-10-23', requesterId: 'owner', status: 'pending', ...overrides }
}

function capture(): RequestsStore {
  const observe = vi.fn<(store: RequestsStore) => void>()
  function Capture() { observe(useRequests()); return null }
  renderToStaticMarkup(<RequestsProvider><Capture /></RequestsProvider>)
  return observe.mock.calls.at(-1)![0]
}

function currentRequests(): UserRequest[] {
  return fixture.commit.mock.lastCall?.[0] ?? fixture.requests
}

beforeEach(() => {
  fixture.users.splice(0, fixture.users.length, person('owner'), person('other'), person('admin', ['admin']))
  fixture.user = fixture.users[0]
  fixture.requests.splice(0, fixture.requests.length, request())
  fixture.commit.mockClear()
})

describe('request cancellation authorization', () => {
  it.each(['department-access', 'permission-change', 'role-change'] as const)('allows the authenticated owner to cancel their pending %s request only', (type) => {
    const owned = request({ type }), other = request({ id: 'other-request', requesterId: 'other' })
    fixture.requests.splice(0, fixture.requests.length, owned, other)
    capture().cancelRequest(owned.id)
    expect(currentRequests()).toEqual([{ ...owned, status: 'cancelled' }, other])
    expect(currentRequests()[1]).toBe(other)
    expect(owned.status).toBe('pending')
    expect(pendingRequests(currentRequests())).toEqual([other])
  })

  it.each(['other', 'admin'])('prevents %s from cancelling another user\'s pending request', (id) => {
    fixture.user = fixture.users.find((user) => user.id === id)!
    const before = structuredClone(fixture.requests)
    capture().cancelRequest('request')
    expect(currentRequests()).toEqual(before)
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it('prevents signed-out callers from cancelling a pending request', () => {
    fixture.user = null
    capture().cancelRequest('request')
    expect(currentRequests()[0].status).toBe('pending')
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it.each(['approved', 'rejected', 'cancelled'] as const)('preserves an owner\'s %s request and decision history', (status) => {
    const settled = request({ status, decidedById: 'admin', decidedAt: '2026-10-23T09:00:00Z' })
    fixture.requests.splice(0, fixture.requests.length, settled)
    capture().cancelRequest(settled.id)
    expect(currentRequests()[0]).toEqual(settled)
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it('ignores unknown request IDs', () => {
    capture().cancelRequest('missing')
    expect(currentRequests()[0].status).toBe('pending')
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it('checks the latest state on duplicate cancellation and subsequent admin decisions', () => {
    fixture.user = fixture.users[2]
    fixture.requests[0].requesterId = fixture.user.id
    const store = capture()
    store.cancelRequest('request')
    store.cancelRequest('request')
    expect(fixture.commit).toHaveBeenCalledTimes(1)
    expect(currentRequests()[0].status).toBe('cancelled')
    expect(() => store.approveRequest('request')).toThrow(/not-pending/)
    expect(() => store.rejectRequest('request')).toThrow(/not-pending/)
  })

  it.each(['approveRequest', 'rejectRequest'] as const)('does not overwrite a newer %s decision with a stale cancellation', (action) => {
    fixture.user = fixture.users[2]
    fixture.requests[0].requesterId = fixture.user.id
    const store = capture()
    store[action]('request')
    const decided = structuredClone(currentRequests())
    store.cancelRequest('request')
    expect(currentRequests()).toEqual(decided)
    expect(fixture.commit).toHaveBeenCalledTimes(1)
  })
})

describe('administrative decisions and directory access remain separate', () => {
  it('preserves admin approval/rejection, independent directory grants, membership and roles', () => {
    fixture.user = fixture.users[2]
    const owner = fixture.users[0], before = structuredClone(owner)
    fixture.requests.splice(0, fixture.requests.length, request(), request({ id: 'second', departmentId: 'b' }), request({ id: 'rejected', departmentId: 'c' }))
    const store = capture()
    store.approveRequest('request')
    store.approveRequest('second')
    store.rejectRequest('rejected')
    expect(currentRequests().map((item) => item.status)).toEqual(['approved', 'approved', 'rejected'])
    expect(currentRequests().every((item) => item.decidedById === 'admin' && !!item.decidedAt)).toBe(true)
    expect(getDirectoryDepartments(owner, currentRequests(), fixture.departments).map((item) => item.id)).toEqual(['home', 'a', 'b'])
    expect(getUserDepartments(owner, fixture.departments).map((item) => item.id)).toEqual(['home'])
    expect(owner).toEqual(before)
  })

  it('does not let a request owner approve or reject their own request', () => {
    const store = capture()
    expect(() => store.approveRequest('request')).toThrow(/Only an admin/)
    expect(() => store.rejectRequest('request')).toThrow(/Only an admin/)
    expect(fixture.commit).not.toHaveBeenCalled()
  })
})
