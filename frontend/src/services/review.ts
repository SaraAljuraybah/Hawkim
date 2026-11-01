/*
 * The internal review actions in the database (see supabase/migrations/). Each one checks
 * who may act and the rules of lib/internalReview.ts again, and writes its timeline events.
 * Rounds, requests and comments are read with each SOP (services/sops.ts).
 */

import type { InternalReviewOptions } from '../lib/internalReview'
import { isValidReviewDuration, RequestExpiredError } from '../lib/internalReviewStatus'
import { ReviewDeadlineUnavailableError } from '../lib/reviewDeadline'
import { ResponseNotAvailableError } from '../lib/reviewRequestRows'
import { SUBMIT_COMMENT_MAX } from '../lib/workflow'
import { supabase } from './supabase'

/** The hint respond_to_comments raises when a request can't receive a response. */
export const RESPONSE_NOT_AVAILABLE_HINT = 'response-not-available'

/** The hint change_review_deadline raises when the request can't be changed any more. */
export const REVIEW_DEADLINE_UNAVAILABLE_HINT = 'review-deadline-unavailable'

/** The hint the reviewer's actions raise when their request has expired. */
export const REQUEST_EXPIRED_HINT = 'request-expired'

async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase().rpc(name, args)
  if (error?.hint === REQUEST_EXPIRED_HINT) throw new RequestExpiredError(error.message)
  if (error) throw new Error(error.message)
  return data
}

/** The options as the database functions take them (blank ones as null). */
function options(o: InternalReviewOptions) {
  if (!isValidReviewDuration(o.reviewDurationDays)) throw new Error('The review duration must be from 1 to 3,650 working days')
  if ((o.note?.trim().length ?? 0) > SUBMIT_COMMENT_MAX) throw new Error('The review request comments are too long')
  return {
    p_reviewer_ids: o.reviewerIds,
    p_response_due_date: o.responseDueDate || null,
    p_review_duration_days: o.reviewDurationDays ?? null,
    p_note: o.note?.trim() || null,
  }
}

/** Main author: the first submission from Draft, or a new version as a new round. */
export async function submitReview(sopId: string, o: InternalReviewOptions): Promise<void> {
  await call('submit_for_review', { p_sop_id: sopId, ...options(o) })
}

/** Main author: sends the current version to more reviewers. */
export async function addReviewers(sopId: string, o: InternalReviewOptions): Promise<void> {
  await call('add_reviewers', { p_sop_id: sopId, ...options(o) })
}

/** Main author: removes a reviewer from the current round, with a reason. */
export async function removeReviewer(requestId: string, reason: string): Promise<void> {
  await call('remove_reviewer', { p_request_id: requestId, p_reason: reason })
}

/** Main author: changes a reviewer's review deadline, to a number of working days from their acceptance. */
export async function changeReviewDeadline(requestId: string, days: number): Promise<void> {
  const { error } = await supabase().rpc('change_review_deadline', { p_request_id: requestId, p_review_duration_days: days })
  if (error?.hint === REVIEW_DEADLINE_UNAVAILABLE_HINT) throw new ReviewDeadlineUnavailableError(error.message)
  if (error) throw new Error(error.message)
}

/** Reviewer: takes the task. */
export async function acceptReview(requestId: string): Promise<void> {
  await call('accept_review', { p_request_id: requestId })
}

/** Reviewer: turns the task down, with a reason. */
export async function declineReview(requestId: string, reason: string): Promise<void> {
  await call('decline_review', { p_request_id: requestId, p_reason: reason })
}

/** Reviewer: completes the review (optional comments) or returns it (required comments). */
export async function decideReview(requestId: string, decision: 'completed' | 'returned', text: string | undefined): Promise<void> {
  await call('decide_review', { p_request_id: requestId, p_decision: decision, p_text: text?.trim() || null })
}

/** Author or co-author: replies to the latest comments, or only to the reviewer of `requestId`. */
export async function respondToComments(sopId: string, text: string, requestId?: string): Promise<void> {
  const { error } = await supabase().rpc('respond_to_comments', { p_sop_id: sopId, p_text: text, ...(requestId ? { p_request_id: requestId } : {}) })
  if (error?.hint === RESPONSE_NOT_AVAILABLE_HINT) throw new ResponseNotAvailableError(error.message)
  if (error) throw new Error(error.message)
}

/** Expires the SOP's requests whose response due date has ended (nothing happens when none are due). */
export async function expireDueRequests(sopId: string): Promise<void> {
  await call('expire_due_requests', { p_sop_id: sopId })
}
