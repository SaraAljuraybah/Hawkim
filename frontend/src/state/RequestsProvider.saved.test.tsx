import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { mockRequests as demoRequests } from '../data/mock/requests'
import type { User, UserRequest } from '../data/mock/types'
import { RequestsProvider } from './RequestsProvider'
import { useRequests, type RequestsStore } from './requestsContext'

/*
 * Regulatory Guideline Addition requests are saved in the database: each action goes to services/requests.ts
 * (the database enforces who may do it), then the saved requests are read again. They never change in the
 * browser only. The other types keep working in memory (RequestsProvider.test.tsx).
 */
const fixture = vi.hoisted(() => ({
  user: null as User | null,
  users: [] as User[],
  saved: [] as UserRequest[],
  status: 'ready' as 'loading' | 'ready' | 'error',
  reload: vi.fn(async () => {}),
}))
const api = vi.hoisted(() => ({
  submitSavedRequest: vi.fn(async () => 'saved-new'),
  cancelSavedRequest: vi.fn(async () => {}),
  decideSavedRequest: vi.fn(async () => {}),
}))
vi.mock('./sessionContext', () => ({ useSession: () => ({ user: fixture.user }) }))
vi.mock('./usersContext', () => ({ useUsers: () => ({ users: fixture.users }) }))
vi.mock('./departmentsContext', () => ({ useDepartments: () => ({ departments: [] }) }))
vi.mock('./useSavedRequests', () => ({
  useSavedRequests: () => ({ status: fixture.status, requests: fixture.saved, latest: () => fixture.saved, reload: fixture.reload }),
}))
vi.mock('../services/requests', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/requests')>()), ...api }))

const person = (id: string, permissions: User['permissions'] = []): User =>
  ({ id, name: id, email: id + '@example.test', initials: 'TT', departmentId: 'home', permissions })
const savedRequest = (overrides: Partial<UserRequest> = {}): UserRequest => ({
  id: 'saved-1', type: 'regulatory-guideline-addition', title: 'Add a guideline', description: 'Please', createdAt: '2026-11-15',
  submittedAt: '2026-11-15T09:00:00Z', requesterId: 'author', status: 'pending', ...overrides,
})

function capture(): RequestsStore {
  const observe = vi.fn<(store: RequestsStore) => void>()
  function Capture() { observe(useRequests()); return null }
  renderToStaticMarkup(<RequestsProvider><Capture /></RequestsProvider>)
  return observe.mock.calls.at(-1)![0]
}

beforeEach(() => {
  fixture.users = [person('author', ['author']), person('admin', ['admin'])]
  fixture.user = fixture.users[0]
  fixture.saved = [savedRequest()]
  fixture.status = 'ready'
  fixture.reload.mockClear()
  Object.values(api).forEach((fn) => fn.mockClear())
})

describe("no demo requests: the list starts empty and shows only the database's requests", () => {
  it("shows a new organization's Admin an empty Requests list (their database has no requests)", () => {
    fixture.user = fixture.users[1]
    fixture.saved = []
    const store = capture()
    expect(store.requests).toEqual([])
    // None of the demo requests (still used by tests) is in the app's list.
    expect(demoRequests.length).toBeGreaterThan(0)
    expect(store.requests.some((request) => demoRequests.some((demo) => demo.id === request.id))).toBe(false)
  })

  it("still lists the database's requests, and only those", () => {
    fixture.user = fixture.users[1]
    expect(capture().requests.map((request) => request.id)).toEqual(['saved-1'])
  })
})

describe('saved requests in the shared requests store', () => {
  it('lists the saved requests (they appear in My Requests and the admin list) and their load status', () => {
    const store = capture()
    expect(store.requests.map((request) => request.id)).toEqual(['saved-1'])
    expect(store.savedStatus).toBe('ready')
    fixture.status = 'error'
    expect(capture().savedStatus).toBe('error')
  })

  it('sends a Regulatory Guideline Addition to the database, then reads the saved requests again', async () => {
    fixture.saved = []
    const created = await capture().addRequest({ type: 'regulatory-guideline-addition', title: 'Add GVP', description: 'Please' })
    expect(api.submitSavedRequest).toHaveBeenCalledWith({ type: 'regulatory-guideline-addition', title: 'Add GVP', description: 'Please' })
    expect(fixture.reload).toHaveBeenCalledOnce()
    expect(created).toMatchObject({ id: 'saved-new', status: 'pending', requesterId: 'author' })
  })

  it('a refused send is not shown as sent', async () => {
    api.submitSavedRequest.mockRejectedValueOnce(new Error('offline'))
    await expect(capture().addRequest({ type: 'regulatory-guideline-addition', title: 'T', description: 'D' })).rejects.toThrow('offline')
  })

  it('cancels a saved request in the database (which checks it is the requester\'s), then reads them again', async () => {
    await capture().cancelRequest('saved-1')
    expect(api.cancelSavedRequest).toHaveBeenCalledWith('saved-1')
    expect(fixture.reload).toHaveBeenCalledOnce()
  })

  it('an Admin\'s approval or rejection is recorded in the database only; nothing else is done', async () => {
    fixture.user = fixture.users[1]
    await capture().approveRequest('saved-1')
    expect(api.decideSavedRequest).toHaveBeenLastCalledWith('saved-1', 'approved')
    await capture().rejectRequest('saved-1')
    expect(api.decideSavedRequest).toHaveBeenLastCalledWith('saved-1', 'rejected')
    expect(fixture.reload).toHaveBeenCalledTimes(2)
  })

  it('a refused decision is passed on (the page says so), and the list is read again', async () => {
    fixture.user = fixture.users[1]
    api.decideSavedRequest.mockRejectedValueOnce(new Error('not-pending'))
    await expect(capture().approveRequest('saved-1')).rejects.toThrow('not-pending')
    expect(fixture.reload).toHaveBeenCalledOnce()
  })

  it('the browser\'s rules still apply first: only Admins decide, only pending requests', () => {
    expect(() => capture().approveRequest('saved-1')).toThrow(/Only an admin/)
    fixture.user = fixture.users[1]
    fixture.saved = [savedRequest({ status: 'cancelled' })]
    expect(() => capture().approveRequest('saved-1')).toThrow(/not-pending/)
    expect(api.decideSavedRequest).not.toHaveBeenCalled()
  })
})
