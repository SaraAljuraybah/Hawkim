import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelSavedRequest, decideSavedRequest, fetchSavedRequests, isSavedRequestType, RequestError, submitSavedRequest, toRequestError } from './requests'

const rpc = vi.fn()
const query = { select: vi.fn(() => query), order: vi.fn(async () => ({ data: rows as unknown[] | null, error: null as unknown })) }
const from = vi.fn(() => query)
vi.mock('./supabase', () => ({ supabase: () => ({ rpc, from }) }))
let rows: unknown[] = []

beforeEach(() => {
  rpc.mockReset()
  from.mockClear()
  query.order.mockClear()
  rows = []
})

describe('saved requests (user_requests)', () => {
  it('only Regulatory Guideline Addition is saved in the database; the other types are not claimed to be', () => {
    expect(isSavedRequestType('regulatory-guideline-addition')).toBe(true)
    expect(isSavedRequestType('department-access')).toBe(false)
    expect(isSavedRequestType('permission-change')).toBe(false)
    expect(isSavedRequestType('role-change')).toBe(false)
  })

  it('reads them from the table (row policies decide whose), newest first', async () => {
    rows = [{
      id: 'r1', type: 'regulatory-guideline-addition', title: 'Add GVP', description: 'Please', status: 'approved',
      requester_id: 'author', created_at: '2026-11-15T09:30:00Z', decided_by: 'admin', decided_at: '2026-11-15T10:00:00Z',
    }, {
      id: 'r2', type: 'regulatory-guideline-addition', title: 'Again', description: 'Please', status: 'pending',
      requester_id: 'author', created_at: '2026-11-14T09:30:00Z', decided_by: null, decided_at: null,
    }]
    const requests = await fetchSavedRequests()
    expect(from).toHaveBeenCalledWith('user_requests')
    expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(requests[0]).toMatchObject({
      id: 'r1', type: 'regulatory-guideline-addition', title: 'Add GVP', status: 'approved', requesterId: 'author',
      submittedAt: '2026-11-15T09:30:00Z', decidedById: 'admin', decidedAt: '2026-11-15T10:00:00Z',
    })
    expect(requests[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(requests[1]).not.toHaveProperty('decidedById')
  })

  it('a failed read is an error, not an empty list', async () => {
    query.order.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'denied' } })
    await expect(fetchSavedRequests()).rejects.toBeInstanceOf(RequestError)
  })

  it('sends only the type, title and description: never an organization or a requester', async () => {
    rpc.mockResolvedValueOnce({ data: 'new-id', error: null })
    expect(await submitSavedRequest({ type: 'regulatory-guideline-addition', title: '  Add GVP ', description: ' Please add it. ' })).toBe('new-id')
    expect(rpc).toHaveBeenCalledWith('submit_user_request', {
      p_type: 'regulatory-guideline-addition', p_title: 'Add GVP', p_description: 'Please add it.',
    })
  })

  it('cancels and decides through the database functions', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await cancelSavedRequest('r2')
    expect(rpc).toHaveBeenLastCalledWith('cancel_user_request', { p_id: 'r2' })
    await decideSavedRequest('r2', 'approved')
    expect(rpc).toHaveBeenLastCalledWith('decide_user_request', { p_id: 'r2', p_decision: 'approved' })
    await decideSavedRequest('r2', 'rejected')
    expect(rpc).toHaveBeenLastCalledWith('decide_user_request', { p_id: 'r2', p_decision: 'rejected' })
  })

  it('passes on what the database refused', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', hint: 'not-pending', message: 'Only a pending request can be cancelled' } })
    await expect(cancelSavedRequest('r1')).rejects.toMatchObject({ reason: 'not-pending' })
    expect(toRequestError({ code: 'P0001', hint: 'requester-deleted' }).reason).toBe('requester-deleted')
    expect(toRequestError({ code: 'P0002' }).reason).toBe('not-found')
    expect(toRequestError({ code: '42501' }).reason).toBe('permission')
    expect(toRequestError({ code: '23514', hint: 'title' })).toMatchObject({ reason: 'invalid', field: 'title' })
    expect(toRequestError({ code: '23514', hint: 'description' })).toMatchObject({ reason: 'invalid', field: 'description' })
    expect(toRequestError({ code: '08006' }).reason).toBe('failed')
  })
})
