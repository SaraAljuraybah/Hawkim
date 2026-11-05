/*
 * Requests to use Hawkim, handled by the access-requests Edge Function (supabase/functions/access-requests).
 * The browser never reads the requests table; the function checks the review link's secret token.
 */

import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { normalizePhone, type RequestValues } from '../lib/accessRequest'
import { supabase } from './supabase'

export type AccessRequestStatus = 'pending' | 'accepted' | 'rejected'

export interface AccessRequestView {
  organization: string
  contactName: string
  jobTitle: string
  email: string
  phone: string
  approxUsers: number
  message: string
  status: AccessRequestStatus
  createdAt: string
  decidedAt: string | null
  expired: boolean
  accountExists: boolean
}

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string; data?: Record<string, unknown> }

async function call<T>(body: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await supabase().functions.invoke('access-requests', { body })
  if (!error) return { ok: true, data: data as T }
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: false, status: response.status, error: String(payload.error ?? 'failed'), data: payload }
  }
  return { ok: false, status: 0, error: error instanceof FunctionsFetchError ? 'not-connected' : 'failed' }
}

export type SubmitFailure = 'invalid' | 'too-many-requests' | 'not-connected' | 'failed'

/** Sends the Request Hawkim form. `website` is a hidden field that only bots fill in. */
export async function submitAccessRequest(values: RequestValues, website = ''): Promise<{ ok: true } | { ok: false; reason: SubmitFailure }> {
  const result = await call<{ ok: true }>({
    action: 'submit',
    organization: values.organization.trim(),
    contactName: values.contactName.trim(),
    jobTitle: values.jobTitle.trim(),
    email: values.email.trim(),
    phone: normalizePhone(values.phone) ?? values.phone.trim(),
    approxUsers: Number(values.approxUsers.trim()),
    message: values.message.trim(),
    website,
  })
  if (result.ok) return { ok: true }
  if (result.error === 'invalid') return { ok: false, reason: 'invalid' }
  if (result.error === 'too_many_requests') return { ok: false, reason: 'too-many-requests' }
  return { ok: false, reason: result.error === 'not-connected' ? 'not-connected' : 'failed' }
}

export type ViewFailure = 'not-found' | 'not-connected' | 'failed'

export async function viewAccessRequest(id: string, token: string): Promise<{ ok: true; request: AccessRequestView } | { ok: false; reason: ViewFailure }> {
  const result = await call<{ request: AccessRequestView }>({ action: 'view', id, token })
  if (result.ok) return { ok: true, request: result.data.request }
  if (result.error === 'not_found') return { ok: false, reason: 'not-found' }
  return { ok: false, reason: result.error === 'not-connected' ? 'not-connected' : 'failed' }
}

export type DecideFailure = 'not-found' | 'already-decided' | 'expired' | 'email-in-use' | 'account-failed' | 'not-connected' | 'failed'

/** Accepts or rejects a request. After accepting, `emailSent` says whether the welcome email went out. */
export async function decideAccessRequest(id: string, token: string, decision: 'accept' | 'reject'): Promise<{ ok: true; emailSent: boolean } | { ok: false; reason: DecideFailure }> {
  const result = await call<{ ok: true; emailSent?: boolean }>({ action: decision, id, token })
  if (result.ok) return { ok: true, emailSent: result.data.emailSent ?? true }
  const reasons: Record<string, DecideFailure> = {
    not_found: 'not-found', already_decided: 'already-decided', expired: 'expired',
    email_in_use: 'email-in-use', account_failed: 'account-failed', 'not-connected': 'not-connected',
  }
  return { ok: false, reason: reasons[result.error] ?? 'failed' }
}
