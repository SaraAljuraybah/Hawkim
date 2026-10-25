import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Department, User, UserRequest } from '../data/mock/types'
import { ActiveDepartmentProvider } from './ActiveDepartmentProvider'
import { useActiveDepartment, type ActiveDepartmentStore } from './activeDepartmentContext'

const fixture = vi.hoisted(() => ({
  user: { id: 'visitor', name: 'Visitor', initials: 'VV', email: 'v@example.test', departmentId: 'home', permissions: ['author', 'reviewer'] } as User,
  departments: ['home', 'a', 'b'].map((id) => ({ id, name: id, initials: id, description: '' })) as Department[],
  requests: [] as UserRequest[], stored: 'a' as string | null,
}))
vi.mock('./sessionContext', () => ({ useCurrentUser: () => fixture.user }))
vi.mock('./requestsContext', () => ({ useRequests: () => ({ requests: fixture.requests }) }))
vi.mock('./departmentsContext', () => ({ useDepartments: () => ({ departments: fixture.departments, activeDepartments: fixture.departments.filter((department) => !department.removedAt) }) }))
const request = (departmentId: string, status: UserRequest['status']): UserRequest => ({ id: departmentId, type: 'department-access', departmentId, requesterId: 'visitor', title: 'Access', description: '', status, createdAt: '2026-10-23' })
function capture(): ActiveDepartmentStore {
  const observe = vi.fn<(store: ActiveDepartmentStore) => void>()
  function Capture() { observe(useActiveDepartment()); return null }
  renderToStaticMarkup(<ActiveDepartmentProvider><Capture /></ActiveDepartmentProvider>)
  return observe.mock.calls.at(-1)![0]
}
beforeEach(() => {
  fixture.requests = []
  fixture.stored = 'a'
  vi.stubGlobal('localStorage', { getItem: () => fixture.stored, setItem: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

describe('directory browsing selection', () => {
  it('selects an approved directory without changing home membership or roles', () => {
    fixture.requests = [request('a', 'approved'), request('b', 'approved')]
    const before = structuredClone(fixture.user), store = capture()
    expect(store.activeDepartment.id).toBe('a')
    expect(store.homeDepartment.id).toBe('home')
    expect(store.directoryDepartments.map((department) => department.id)).toEqual(['home', 'a', 'b'])
    store.setActiveDepartment('b')
    expect(fixture.user).toEqual(before)
  })
  it.each(['pending', 'rejected', 'cancelled'] as const)('ignores a stored directory with only %s access', (status) => {
    fixture.requests = [request('a', status)]
    const store = capture()
    expect(store.activeDepartment.id).toBe('home')
    expect(store.directoryDepartments.map((department) => department.id)).toEqual(['home'])
  })
  it('does not use another user approved request or an unavailable stored directory', () => {
    fixture.requests = [{ ...request('a', 'approved'), requesterId: 'other' }]
    expect(capture().activeDepartment.id).toBe('home')
    fixture.stored = 'unknown'
    expect(capture().activeDepartment.id).toBe('home')
  })
  it('starts in the home department when nothing is stored (as after signing in)', () => {
    fixture.requests = [request('a', 'approved')]
    fixture.stored = null
    expect(capture().activeDepartment.id).toBe('home')
  })
})
