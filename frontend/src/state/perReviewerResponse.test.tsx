import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { InternalReviewerAssignment, Sop, User } from '../data/mock/types'
import { sopWorkflowEn } from '../content/workflow.en'
import { canRespondToRequest, hasResponseOutsideReviewers, requestResponseRecipients, ResponseNotAvailableError, responseFailure } from '../lib/reviewRequestRows'
import { fetchSop } from '../services/sops'
import { addResponse, timelineRecipients } from '../lib/workflow'
import { SopsProvider } from './SopsProvider'
import { useSops, type SopsStore } from './sopsContext'

/*
 * Both settings of PER_REVIEWER_RESPONSE_ACTIVE. v1: Alpha returned it and Gone returned it, then
 * was removed. v2: Beta completed it with a comment and Quiet without one. Today's response
 * window starts at v2, so Alpha is not a current recipient.
 */
const { author, sop, flag, respondToComments } = vi.hoisted(() => {
  const author = { id: 'author', name: 'Main Author', email: 'author@hawkim.test', initials: 'MA', departmentId: 'home', permissions: ['author'] } as User
  const request = (id: string, userId: string, decision: string, commentId?: string) => ({ id, userId, decision, assignedAt: '2026-10-01T08:00:00Z', ...(commentId ? { commentId } : {}) })
  const comment = (id: string, authorUserId: string, version: string, createdAt: string) => ({ id, authorUserId, role: 'reviewer', text: `${id} text`, createdAt, version })
  const sop = {
    id: 'sop', code: 'SOP-001', title: 'Backup', departmentId: 'home', authorId: 'author', coAuthorIds: [], status: 'in-review', version: '2', lastUpdated: '2026-10-10',
    fileName: 'Backup.pdf', fileType: 'pdf', reviewers: [], approvers: [], complianceChecks: [], versions: [],
    comments: [comment('return', 'alpha', '1', '2026-10-02T08:00:00Z'), comment('gone-return', 'gone', '1', '2026-10-02T09:00:00Z'), comment('complete', 'beta', '2', '2026-10-06T08:00:00Z')],
    timeline: [{ id: 'first', type: 'submitted', actorId: 'author', version: '1', createdAt: '2026-10-01T08:00:00Z' }, { id: 'second', type: 'submitted', actorId: 'author', version: '2', createdAt: '2026-10-05T08:00:00Z' }],
    internalReviewRounds: [
      { id: 'round-1', scope: 'internal', version: '1', status: 'changes-requested', requestedById: 'author', requestedAt: '2026-10-01T08:00:00Z', assignedDueDays: null, assignments: [request('req-alpha', 'alpha', 'returned', 'return'), request('req-gone', 'gone', 'removed', 'gone-return')] },
      { id: 'round-2', scope: 'internal', version: '2', status: 'completed', requestedById: 'author', requestedAt: '2026-10-05T08:00:00Z', assignedDueDays: null, assignments: [request('req-beta', 'beta', 'completed', 'complete'), request('req-quiet', 'quiet', 'completed')] },
    ],
  } as unknown as Sop
  return { author, sop, flag: { active: false }, respondToComments: vi.fn() }
})

vi.mock('../lib/internalReviewStatus', async (original) => ({
  ...await original<typeof import('../lib/internalReviewStatus')>(),
  get PER_REVIEWER_RESPONSE_ACTIVE() { return flag.active },
}))
vi.mock('../data/mock/sops', () => ({ sops: [sop] }))
vi.mock('./sessionContext', () => ({ useSession: () => ({ user: author }) }))
vi.mock('./usersContext', () => ({ useUsers: () => ({ users: [author], getUser: () => author }) }))
vi.mock('./departmentsContext', () => ({ useDepartments: () => ({ departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '' }] }) }))
vi.mock('./guidelinesContext', () => ({ useGuidelines: () => ({ currentGuideline: { name: 'GVP', version: '4.0' } }) }))
vi.mock('../services/review', () => ({ respondToComments, expireDueRequests: vi.fn() }))
vi.mock('../services/sops', () => ({ fetchSops: vi.fn(async () => []), fetchSop: vi.fn(async () => sop) }))

const requestOf = (id: string) => sop.internalReviewRounds!.flatMap((round) => round.assignments).find((item) => item.id === id) as InternalReviewerAssignment
function store(): SopsStore {
  const observe = vi.fn<(value: SopsStore) => void>()
  function Capture() { observe(useSops()); return null }
  renderToStaticMarkup(<SopsProvider><Capture /></SopsProvider>)
  return observe.mock.calls.at(-1)![0]
}

// In braces: a function returned from beforeEach would run as its cleanup.
beforeEach(() => { respondToComments.mockReset().mockResolvedValue(undefined) })

describe('with PER_REVIEWER_RESPONSE_ACTIVE off (today)', () => {
  beforeEach(() => { flag.active = false })

  it('offers Response only to a commenting, non-removed reviewer among the current recipients', () => {
    expect(canRespondToRequest(sop, requestOf('req-beta'))).toBe(true)
    expect(canRespondToRequest(sop, requestOf('req-alpha'))).toBe(false)
    expect(canRespondToRequest(sop, requestOf('req-quiet'))).toBe(false)
    expect(canRespondToRequest(sop, requestOf('req-gone'))).toBe(false)
    expect(canRespondToRequest({ ...sop, status: 'published' }, requestOf('req-beta'))).toBe(false)
  })

  it('shows and sends to all current recipients with the existing function', async () => {
    expect(requestResponseRecipients(sop, requestOf('req-beta'))).toEqual(['beta'])
    await store().addResponse('sop', '  Thanks  ', 'req-beta')
    expect(respondToComments).toHaveBeenCalledWith('sop', 'Thanks', undefined)
  })
})

describe('with PER_REVIEWER_RESPONSE_ACTIVE on (after the database change)', () => {
  beforeEach(() => { flag.active = true })

  it('offers Response on any version, still only to commenting, non-removed reviewers', () => {
    expect(canRespondToRequest(sop, requestOf('req-alpha'))).toBe(true)
    expect(canRespondToRequest(sop, requestOf('req-beta'))).toBe(true)
    expect(canRespondToRequest(sop, requestOf('req-quiet'))).toBe(false)
    expect(canRespondToRequest(sop, requestOf('req-gone'))).toBe(false)
    expect(canRespondToRequest({ ...sop, status: 'published' }, requestOf('req-alpha'))).toBe(false)
  })

  it('shows only that reviewer and passes the request id to the service', async () => {
    expect(requestResponseRecipients(sop, requestOf('req-alpha'))).toEqual(['alpha'])
    await store().addResponse('sop', '  Thanks  ', 'req-alpha')
    expect(respondToComments).toHaveBeenCalledWith('sop', 'Thanks', 'req-alpha')
  })

  it('records it for that reviewer only, on the version of their request, so the timeline "To" shows only them', () => {
    const event = addResponse(sop, 'author', 'Thanks', 'req-alpha').timeline.at(-1)!
    expect(event).toMatchObject({ type: 'response', version: '1', recipientIds: ['alpha'], reviewAssignmentId: 'req-alpha', note: 'Thanks' })
    expect(timelineRecipients(sop, event, true)).toEqual(['alpha'])
  })

  it('refuses a removed reviewer and a request without a comment in the browser too, before asking the database', async () => {
    expect(() => addResponse(sop, 'author', 'Thanks', 'req-gone')).toThrow(/removed/)
    expect(() => addResponse(sop, 'author', 'Thanks', 'req-quiet')).toThrow(/no comments/)
    await expect(store().addResponse('sop', 'Thanks', 'req-quiet')).rejects.toThrow(/no comments/)
    expect(respondToComments).not.toHaveBeenCalled()
  })

  it('reads the SOP again when the database refuses, and passes the refusal on', async () => {
    const sops = store()
    vi.mocked(fetchSop).mockClear()
    respondToComments.mockRejectedValue(new ResponseNotAvailableError('Removed'))
    await expect(sops.addResponse('sop', 'Thanks', 'req-beta')).rejects.toBeInstanceOf(ResponseNotAvailableError)
    expect(fetchSop).toHaveBeenCalledWith('sop')
  })

  it('still reports the refusal if reading the SOP again fails', async () => {
    const sops = store()
    vi.mocked(fetchSop).mockRejectedValueOnce(new Error('Offline'))
    respondToComments.mockRejectedValue(new ResponseNotAvailableError('Removed'))
    await expect(sops.addResponse('sop', 'Thanks', 'req-beta')).rejects.toBeInstanceOf(ResponseNotAvailableError)
  })

  it('does not read the SOP again after any other failure', async () => {
    const sops = store()
    vi.mocked(fetchSop).mockClear()
    respondToComments.mockRejectedValue(new Error('Connection lost'))
    await expect(sops.addResponse('sop', 'Thanks', 'req-beta')).rejects.toThrow('Connection lost')
    expect(fetchSop).not.toHaveBeenCalled()
  })

  it('explains a refused response, and keeps the general message otherwise', () => {
    const text = sopWorkflowEn.dialogs.response
    expect(text[responseFailure(new ResponseNotAvailableError('Removed'))]).toBe(text.unavailable)
    expect(text[responseFailure(new Error('Connection lost'))]).toBe(text.failed)
  })

  it('still answers everyone from the header fallback, which passes no request id', async () => {
    await store().addResponse('sop', 'Thanks')
    expect(respondToComments).toHaveBeenCalledWith('sop', 'Thanks', undefined)
  })
})

describe('header Response fallback', () => {
  it.each([true, false])('stays away while every recipient is on a reviewer row (per-reviewer: %s)', (active) => {
    flag.active = active
    expect(hasResponseOutsideReviewers(sop)).toBe(false)
  })

  it('appears for an approver comment and for a legacy SOP without review rounds', () => {
    const approver = { id: 'approval', authorUserId: 'approver', role: 'approver', text: 'Fix it', createdAt: '2026-10-07T08:00:00Z', version: '2' }
    expect(hasResponseOutsideReviewers({ ...sop, comments: [...sop.comments, approver] } as Sop)).toBe(true)
    expect(hasResponseOutsideReviewers({ ...sop, internalReviewRounds: undefined })).toBe(true)
    expect(hasResponseOutsideReviewers({ ...sop, comments: [], internalReviewRounds: undefined })).toBe(false)
  })
})
