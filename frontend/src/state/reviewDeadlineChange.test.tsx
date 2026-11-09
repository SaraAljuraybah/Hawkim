import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Sop, User } from '../data/mock/types'
import { ReviewDeadlineUnavailableError } from '../lib/reviewDeadline'
import { fetchSop } from '../services/sops'
import { SopsProvider } from './SopsProvider'
import { useSops, type SopsStore } from './sopsContext'

const { author, sop, changeReviewDeadline } = vi.hoisted(() => {
  const author = { id: 'author', name: 'Main Author', email: 'author@hawkim.test', initials: 'MA', departmentId: 'home', permissions: ['author'] } as User
  const sop = {
    id: 'sop', code: 'SOP-001', title: 'Backup', departmentId: 'home', authorId: 'author', coAuthorIds: [], status: 'in-review', version: '1', lastUpdated: '2026-10-10',
    fileName: 'Backup.pdf', fileType: 'pdf', reviewers: [], approvers: [], complianceChecks: [], versions: [], comments: [], timeline: [],
    internalReviewRounds: [{ id: 'round', scope: 'internal', version: '1', status: 'open', requestedById: 'author', requestedAt: '2099-01-01T08:00:00Z', assignedDueDays: null,
      assignments: [{ id: 'request', userId: 'alpha', decision: 'accepted', assignedAt: '2099-01-01T08:00:00Z', acceptedAt: '2099-01-02T08:00:00Z', assignedDueDays: null }] }],
  } as unknown as Sop
  return { author, sop, changeReviewDeadline: vi.fn() }
})

vi.mock('../data/mock/sops', () => ({ sops: [sop] }))
vi.mock('./sessionContext', () => ({ useSession: () => ({ user: author }) }))
vi.mock('./usersContext', () => ({ useUsers: () => ({ users: [author], getUser: () => author }) }))
vi.mock('./departmentsContext', () => ({ useDepartments: () => ({ departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '' }] }) }))
vi.mock('./guidelinesContext', () => ({ useGuidelines: () => ({ currentGuideline: { name: 'GVP', version: '4.0' } }) }))
vi.mock('../services/review', () => ({ changeReviewDeadline, expireDueRequests: vi.fn() }))
vi.mock('../services/sops', () => ({ fetchSops: vi.fn(async () => []), fetchSop: vi.fn(async () => sop) }))

function store(): SopsStore {
  const observe = vi.fn<(value: SopsStore) => void>()
  function Capture() { observe(useSops()); return null }
  renderToStaticMarkup(<SopsProvider><Capture /></SopsProvider>)
  return observe.mock.calls.at(-1)![0]
}

// In braces: a function returned from beforeEach would run as its cleanup.
beforeEach(() => {
  changeReviewDeadline.mockReset().mockResolvedValue(undefined)
  vi.mocked(fetchSop).mockClear()
})

describe('changing a review deadline from the store', () => {
  it('checks the rule, saves it in the database, then reads the SOP again', async () => {
    await store().changeReviewDeadline('sop', 'round', 'request', 5)
    expect(changeReviewDeadline).toHaveBeenCalledWith('request', 5)
    expect(fetchSop).toHaveBeenCalledWith('sop')
  })

  it('refuses what the rule refuses, without asking the database', async () => {
    await expect(store().changeReviewDeadline('sop', 'round', 'request', 3651)).rejects.toThrow(/1 to 3,650/)
    expect(changeReviewDeadline).not.toHaveBeenCalled()
  })

  it('reads the SOP again when the database refuses, and passes the refusal on', async () => {
    changeReviewDeadline.mockRejectedValue(new ReviewDeadlineUnavailableError('Finished'))
    await expect(store().changeReviewDeadline('sop', 'round', 'request', 5)).rejects.toBeInstanceOf(ReviewDeadlineUnavailableError)
    expect(fetchSop).toHaveBeenCalledWith('sop')
  })

  it('does not read the SOP again after any other failure', async () => {
    changeReviewDeadline.mockRejectedValue(new Error('Connection lost'))
    await expect(store().changeReviewDeadline('sop', 'round', 'request', 5)).rejects.toThrow('Connection lost')
    expect(fetchSop).not.toHaveBeenCalled()
  })
})
