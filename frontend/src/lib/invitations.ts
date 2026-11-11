import { notificationsEn } from '../content/notifications.en'
import type { ResendFailureReason } from '../services/invitations'

/** What the notifications panel says after Resend invitation: where it was sent, or why it wasn't. */
export function resendMessage(
  result: { ok: true; email: string } | { ok: false; reason: ResendFailureReason },
  invitation: { name: string; email: string },
): string {
  const text = notificationsEn.invitations
  return (result.ok ? text.sent : text.failures[result.reason])
    .replace('{name}', invitation.name)
    .replace('{email}', result.ok ? result.email : invitation.email)
}
