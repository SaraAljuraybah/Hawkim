/** Pure, testable rules for manage-users (no credentials here). */

/** A database refusal as a stable, safe error code (the messages are raised in the migrations). */
export function errorCodeFor(error: { code?: string; message?: string }): string {
  const byMessage: Record<string, string> = {
    'Email already in use': 'email-taken',
    'Department is no longer available': 'department-unavailable',
    'Approver is only allowed in the Quality department': 'approver-quality',
    'An admin cannot have any other role': 'admin-exclusive',
    'You cannot delete your own account': 'self-delete',
    'At least one admin must remain': 'last-admin',
    'This user still has work in progress on SOPs': 'in-use',
  }
  if (error.message && byMessage[error.message]) return byMessage[error.message]
  if (error.code === '42501') return 'forbidden'
  if (error.code === '40001') return 'conflict'
  if (error.code === '23514') return 'invalid'
  return 'failed'
}

/** Only a /reset-password address; Supabase Auth also checks it against the Redirect URLs allow-list. */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.pathname !== '/reset-password' || url.search || url.hash) return undefined
    return url.toString()
  } catch { return undefined }
}
