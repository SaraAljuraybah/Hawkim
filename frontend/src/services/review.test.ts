import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewDeadlineUnavailableError } from '../lib/reviewDeadline'
import { ResponseNotAvailableError } from '../lib/reviewRequestRows'
import { acceptReview, addReviewers, changeReviewDeadline, declineReview, decideReview, removeReviewer, respondToComments, RESPONSE_NOT_AVAILABLE_HINT, REVIEW_DEADLINE_UNAVAILABLE_HINT, submitReview, withdrawDueRequests } from './review'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: () => ({ rpc }) }))

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: null, error: null })
})

describe('the internal review in the database', () => {
  it('sends the request options, with blank ones as null', async () => {
    await submitReview('uuid-sop', { reviewerIds: ['uuid-noura', 'uuid-lulwah'], responseDueDate: '2026-10-30', reviewDurationDays: 5, note: '  Ready  ' })
    expect(rpc).toHaveBeenLastCalledWith('submit_for_review', {
      p_sop_id: 'uuid-sop', p_reviewer_ids: ['uuid-noura', 'uuid-lulwah'], p_response_due_date: '2026-10-30', p_review_duration_days: 5, p_note: 'Ready',
    })
    await addReviewers('uuid-sop', { reviewerIds: ['uuid-noura'], responseDueDate: '', note: ' ' })
    expect(rpc).toHaveBeenLastCalledWith('add_reviewers', {
      p_sop_id: 'uuid-sop', p_reviewer_ids: ['uuid-noura'], p_response_due_date: null, p_review_duration_days: null, p_note: null,
    })
  })

  it('acts on one request at a time', async () => {
    await acceptReview('req-1')
    expect(rpc).toHaveBeenLastCalledWith('accept_review', { p_request_id: 'req-1' })
    await declineReview('req-1', 'On leave')
    expect(rpc).toHaveBeenLastCalledWith('decline_review', { p_request_id: 'req-1', p_reason: 'On leave' })
    await decideReview('req-1', 'completed', '  ')
    expect(rpc).toHaveBeenLastCalledWith('decide_review', { p_request_id: 'req-1', p_decision: 'completed', p_text: null })
    await decideReview('req-1', 'returned', ' Add a section ')
    expect(rpc).toHaveBeenLastCalledWith('decide_review', { p_request_id: 'req-1', p_decision: 'returned', p_text: 'Add a section' })
    await removeReviewer('req-1', 'Not needed')
    expect(rpc).toHaveBeenLastCalledWith('remove_reviewer', { p_request_id: 'req-1', p_reason: 'Not needed' })
  })

  it('sends the entire supported 500-character comment and rejects longer text before an RPC', async () => {
    await submitReview('uuid-sop', { reviewerIds: ['uuid-noura'], reviewDurationDays: 30, note: 'x'.repeat(500) })
    expect(rpc).toHaveBeenLastCalledWith('submit_for_review', expect.objectContaining({ p_note: 'x'.repeat(500), p_review_duration_days: 30 }))
    rpc.mockClear()
    await expect(addReviewers('uuid-sop', { reviewerIds: ['uuid-noura'], note: 'x'.repeat(501) })).rejects.toThrow(/too long/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([0, -1, 3651, 1.5, NaN])('rejects an invalid working-day allocation %s without an RPC', async (reviewDurationDays) => {
    await expect(submitReview('uuid-sop', { reviewerIds: ['uuid-noura'], reviewDurationDays })).rejects.toThrow(/1 to 3,650/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([undefined, 1, 30])('preserves the optional duration and its boundaries (%s) in the RPC contract', async (reviewDurationDays) => {
    await submitReview('uuid-sop', { reviewerIds: ['uuid-noura'], reviewDurationDays })
    expect(rpc).toHaveBeenLastCalledWith('submit_for_review', expect.objectContaining({
      p_review_duration_days: reviewDurationDays ?? null, p_response_due_date: null,
    }))
  })

  it('preserves a full Unicode submission comment and rejects excess UTF-16 units before calling the server', async () => {
    const note = '😀'.repeat(250) // 500 UTF-16 units: the agreed limit
    await submitReview('uuid-sop', { reviewerIds: ['uuid-noura'], note: `  ${note}  ` })
    expect(rpc).toHaveBeenLastCalledWith('submit_for_review', expect.objectContaining({ p_note: note }))
    rpc.mockClear()
    await expect(addReviewers('uuid-sop', { reviewerIds: ['uuid-noura'], note: note + 'x' })).rejects.toThrow(/too long/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('changes a review deadline, and recognises a stale request by its hint, and only by that', async () => {
    await changeReviewDeadline('uuid-request', 7)
    expect(rpc).toHaveBeenLastCalledWith('change_review_deadline', { p_request_id: 'uuid-request', p_review_duration_days: 7 })
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Any wording', code: '23514', hint: REVIEW_DEADLINE_UNAVAILABLE_HINT } })
    await expect(changeReviewDeadline('uuid-request', 7)).rejects.toBeInstanceOf(ReviewDeadlineUnavailableError)
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Another refusal', code: '23514', hint: null } })
    await expect(changeReviewDeadline('uuid-request', 7)).rejects.not.toBeInstanceOf(ReviewDeadlineUnavailableError)
  })

  it('recognises a response the database refused by its hint, and only by that', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Any wording', code: '23514', hint: RESPONSE_NOT_AVAILABLE_HINT } })
    await expect(respondToComments('uuid-sop', 'Done', 'uuid-request')).rejects.toBeInstanceOf(ResponseNotAvailableError)
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Another refusal', code: '23514', hint: null } })
    await expect(respondToComments('uuid-sop', 'Done', 'uuid-request')).rejects.not.toBeInstanceOf(ResponseNotAvailableError)
  })

  it('sends responses and asks for due withdrawals', async () => {
    await respondToComments('uuid-sop', 'Done')
    expect(rpc).toHaveBeenLastCalledWith('respond_to_comments', { p_sop_id: 'uuid-sop', p_text: 'Done' })
    await respondToComments('uuid-sop', 'Done', 'uuid-request')
    expect(rpc).toHaveBeenLastCalledWith('respond_to_comments', { p_sop_id: 'uuid-sop', p_text: 'Done', p_request_id: 'uuid-request' })
    await withdrawDueRequests('uuid-sop')
    expect(rpc).toHaveBeenLastCalledWith('withdraw_due_requests', { p_sop_id: 'uuid-sop' })
  })

  it('throws what the database refuses', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'This review has already been accepted' } })
    await expect(acceptReview('req-1')).rejects.toThrow('already been accepted')
  })
})
