/*
 * Persisted user administration (admin only; the database and the `manage-users` Edge Function
 * enforce every rule again, so the browser's checks only explain them earlier):
 * - create: Edge Function → Auth invitation + create_employee_profile (profile, positions, roles);
 * - permissions: set_user_roles RPC;
 * - delete: Edge Function → delete_user_profile + Auth ban.
 * The browser never holds a service-role key and never calls the Auth admin API.
 */

import type { Permission } from '../data/mock/types'
import { usersAdminEn as text } from '../content/usersAdmin.en'
import { RESET_PASSWORD_PATH } from '../lib/routes'
import { organizationEvents, ORGANIZATION_CHANGED } from './organizationAdmin'
import { supabase } from './supabase'

export interface CreateUserInput {
  name: string
  email: string
  phone: string
  departmentId: string
  /** The first one is the primary position. */
  positions: string[]
  permissions: Permission[]
}

/** The Edge Function / database refusal codes, as what the admin should do next. */
const MESSAGES: Record<string, string> = {
  'email-taken': text.emailTaken,
  'department-unavailable': text.departmentUnavailable,
  'approver-quality': text.approverQuality,
  'admin-exclusive': text.adminExclusive,
  'self-delete': text.selfDelete,
  'last-admin': text.lastAdmin,
  'in-use': text.inUse,
  'invite-failed': text.inviteFailed,
  'ban-failed': text.banFailed,
  forbidden: text.forbidden,
  unauthorized: text.forbidden,
  conflict: text.conflict,
  invalid: text.invalid,
  'invalid-request': text.invalid,
}

/** Database messages raised by set_user_roles (see 20261105160000_user_management_and_consistency.sql). */
const ROLE_MESSAGES: Record<string, string> = {
  'You cannot remove your own Admin permission': text.selfAdmin,
  'At least one admin must remain': text.lastAdmin,
  'This permission is in use on SOPs': text.inUse,
  'An admin cannot have any other role': text.adminExclusive,
  'Approver is only allowed in the Quality department': text.approverQuality,
}

function changed() { organizationEvents.dispatchEvent(new Event(ORGANIZATION_CHANGED)) }

async function invoke(body: Record<string, unknown>): Promise<{ userId: string }> {
  const { data, error } = await supabase().functions.invoke('manage-users', { body })
  if (!error) return data as { userId: string }
  let code: string | undefined
  // Supabase puts non-2xx JSON bodies on FunctionsHttpError.context.
  try { code = ((await error.context?.json()) as { errorCode?: string } | undefined)?.errorCode } catch { /* fallback below */ }
  throw new Error((code && MESSAGES[code]) ?? text.failed)
}

/** Creates the account (an invitation email to set a password) and the employee. Returns the new id. */
export async function createUser(input: CreateUserInput): Promise<string> {
  const { userId } = await invoke({
    action: 'create',
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone,
    departmentId: input.departmentId,
    positions: input.positions.map((title) => title.trim()).filter(Boolean),
    roles: input.permissions,
    redirectTo: `${window.location.origin}${RESET_PASSWORD_PATH}`,
  })
  changed()
  return userId
}

/** Replaces a user's permissions. */
export async function setUserPermissions(userId: string, permissions: Permission[]): Promise<void> {
  const { error } = await supabase().rpc('set_user_roles', { p_user_id: userId, p_roles: permissions })
  if (error) {
    if (error.code === '42501') throw new Error(text.forbidden)
    if (error.code === '40001') throw new Error(text.conflict)
    throw new Error(ROLE_MESSAGES[error.message] ?? text.failed)
  }
  changed()
}

/** Ends the user's profile (their name stays on history) and blocks their sign-in. */
export async function deleteUserAccount(userId: string): Promise<void> {
  await invoke({ action: 'delete', userId })
  changed()
}
