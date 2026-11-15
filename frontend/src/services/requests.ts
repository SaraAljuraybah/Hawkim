/*
 * Requests to the Admins that are saved in the database (supabase/migrations/20261120140000_user_requests.sql).
 * Only "Regulatory Guideline Addition" so far; the other request types are still kept in the browser
 * (state/RequestsProvider.tsx). The database sets the requester and the organization from the signed-in user
 * and decides who may read, cancel and decide each request; these functions only call it.
 */

import type { RequestType, UserRequest } from '../data/mock/types'
import { todayIsoDate } from '../lib/format'
import type { Status } from '../types/status'
import { supabase } from './supabase'

/** The request types saved in the database. */
export const SAVED_REQUEST_TYPES: readonly RequestType[] = ['regulatory-guideline-addition']

/** Whether requests of this type are saved in the database (and so survive a reload). */
export function isSavedRequestType(type: RequestType): boolean {
  return SAVED_REQUEST_TYPES.includes(type)
}

/**
 * Why the database refused:
 * - not-pending:       the request was already cancelled, approved or rejected (by someone else, too);
 * - requester-deleted: a request from a deleted user can only be rejected;
 * - not-found:         it doesn't exist for this user (or isn't theirs to cancel);
 * - permission:        the user may not do this;
 * - invalid:           a field was refused (`field` says which, when known);
 * - failed:            anything else (the connection, for example).
 */
export type RequestErrorReason = 'not-pending' | 'requester-deleted' | 'not-found' | 'permission' | 'invalid' | 'failed'

export class RequestError extends Error {
  readonly reason: RequestErrorReason
  readonly field?: 'type' | 'title' | 'description'
  constructor(reason: RequestErrorReason, message: string, field?: 'type' | 'title' | 'description') {
    super(message)
    this.reason = reason
    this.field = field
  }
}

export function toRequestError(error: { code?: string; message?: string; hint?: string }): RequestError {
  const message = error.message ?? 'The request could not be saved'
  if (error.code === 'P0001' && (error.hint === 'not-pending' || error.hint === 'requester-deleted')) return new RequestError(error.hint, message)
  if (error.code === 'P0002') return new RequestError('not-found', message)
  if (error.code === '42501') return new RequestError('permission', message)
  if (error.code === '23514') {
    const field = error.hint === 'type' || error.hint === 'title' || error.hint === 'description' ? error.hint : undefined
    return new RequestError('invalid', message, field)
  }
  return new RequestError('failed', message)
}

/** A row of user_requests, as read. */
export interface UserRequestRow {
  id: string
  type: RequestType
  title: string
  description: string
  status: Status
  requester_id: string
  created_at: string
  decided_by: string | null
  decided_at: string | null
}

const COLUMNS = 'id, type, title, description, status, requester_id, created_at, decided_by, decided_at'

export function toUserRequest(row: UserRequestRow): UserRequest {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    description: row.description,
    // The day it was sent where the user is (My Requests shows the date), and the exact time.
    createdAt: todayIsoDate(new Date(row.created_at)),
    submittedAt: row.created_at,
    status: row.status,
    requesterId: row.requester_id,
    ...(row.decided_by ? { decidedById: row.decided_by } : {}),
    ...(row.decided_at ? { decidedAt: row.decided_at } : {}),
  }
}

/**
 * The saved requests this user may read, newest first: their own, or, for an Admin, every request of their
 * organization (the database's row policies decide; never another organization's).
 */
export async function fetchSavedRequests(): Promise<UserRequest[]> {
  const { data, error } = await supabase().from('user_requests').select(COLUMNS).order('created_at', { ascending: false })
  if (error) throw toRequestError(error)
  return (data as UserRequestRow[]).map(toUserRequest)
}

/** Sends a request as the signed-in user; returns its id. */
export async function submitSavedRequest(input: { type: RequestType; title: string; description: string }): Promise<string> {
  const { data, error } = await supabase().rpc('submit_user_request', {
    p_type: input.type,
    p_title: input.title.trim(),
    p_description: input.description.trim(),
  })
  if (error) throw toRequestError(error)
  return data as string
}

/** Cancels the signed-in user's own pending request. */
export async function cancelSavedRequest(id: string): Promise<void> {
  const { error } = await supabase().rpc('cancel_user_request', { p_id: id })
  if (error) throw toRequestError(error)
}

/** An Admin approves or rejects a pending request of their organization. Approving only records the decision. */
export async function decideSavedRequest(id: string, decision: 'approved' | 'rejected'): Promise<void> {
  const { error } = await supabase().rpc('decide_user_request', { p_id: id, p_decision: decision })
  if (error) throw toRequestError(error)
}
