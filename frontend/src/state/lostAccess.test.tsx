import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Sop, User } from '../data/mock/types'
import { SopsProvider } from './SopsProvider'
import { useSops, type SopsStore } from './sopsContext'

/** An other-department reviewer declines: the database no longer returns the SOP to them. */
const { reviewer, sop, service, fetchSop } = vi.hoisted(() => {
  const reviewer = { id: 'other', name: 'Other', email: 'other@hawkim.test', initials: 'OT', departmentId: 'foreign', permissions: ['reviewer'] } as User
  const request = { id: 'request', userId: 'other', decision: 'pending', assignedAt: '2026-10-01T08:00:00Z' }
  const sop = {
    id: 'sop', code: 'SOP-001', title: 'Backup', departmentId: 'home', authorId: 'author', coAuthorIds: [], status: 'in-review', version: '1', lastUpdated: '2026-10-10',
    fileName: 'Backup.pdf', fileType: 'pdf', reviewers: [], approvers: [], complianceChecks: [], versions: [{ version: '1', fileName: 'Backup.pdf', fileType: 'pdf', uploadedAt: '2026-10-01T08:00:00Z' }], comments: [], timeline: [],
    internalReviewRounds: [{ id: 'round', scope: 'internal', version: '1', status: 'open', requestedById: 'author', requestedAt: '2026-10-01T08:00:00Z', assignedDueDays: null, assignments: [request] }],
  } as unknown as Sop
  return { reviewer, sop, service: { declineReview: vi.fn(), fetchClosedReviewRequests: vi.fn() }, fetchSop: vi.fn() }
})
vi.mock('../data/mock/sops', () => ({ sops: [sop] }))
vi.mock('./sessionContext', () => ({ useSession: () => ({ user: reviewer }) }))
vi.mock('./usersContext', () => ({ useUsers: () => ({ users: [reviewer], getUser: () => reviewer }) }))
vi.mock('./departmentsContext', () => ({ useDepartments: () => ({ departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '' }, { id: 'foreign', name: 'Foreign', initials: 'FO', description: '' }] }) }))
vi.mock('./guidelinesContext', () => ({ useGuidelines: () => ({ currentGuideline: { name: 'GVP', version: '4.0' } }) }))
vi.mock('../services/review', () => service)
vi.mock('../services/sops', () => ({ fetchSops: vi.fn(async () => []), fetchSop }))

function store(): SopsStore {
  const observe = vi.fn<(value: SopsStore) => void>()
  function Capture() { observe(useSops()); return null }
  renderToStaticMarkup(<SopsProvider><Capture /></SopsProvider>)
  return observe.mock.calls.at(-1)![0]
}

beforeEach(() => {
  service.declineReview.mockReset().mockResolvedValue(undefined)
  service.fetchClosedReviewRequests.mockReset().mockResolvedValue([])
  fetchSop.mockReset().mockResolvedValue(null)
})

describe('a reviewer who loses access by acting', () => {
  it('finishes the decline without an error, and reads their closed requests', async () => {
    await expect(store().declineInternalReview('sop', 'round', 'request', 'Busy')).resolves.toBeUndefined()
    expect(service.declineReview).toHaveBeenCalledWith('request', 'Busy')
    expect(service.fetchClosedReviewRequests).toHaveBeenCalled()
  })

  it('does not fail if the closed requests can\'t be read', async () => {
    service.fetchClosedReviewRequests.mockRejectedValue(new Error('Not there yet'))
    await expect(store().declineInternalReview('sop', 'round', 'request', 'Busy')).resolves.toBeUndefined()
  })
})
