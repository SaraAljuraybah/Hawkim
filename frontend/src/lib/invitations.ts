import { notificationsEn } from '../content/notifications.en'
import { startPasswordRecovery } from '../services/auth'
import { fetchInvitationLinkState, type ResendFailureReason } from '../services/invitations'

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

/**
 * What the link opens: 'cancelled' when it carries an invitation an Admin cancelled (no session is started
 * from it), otherwise 'ready' once the recovery session started from it, or 'invalid'.
 */
export async function linkStage(search: string, hash: string, steps = { fetchInvitationLinkState, startPasswordRecovery }): Promise<'ready' | 'invalid' | 'cancelled'> {
  const linkRef = new URLSearchParams(search).get('invitation')
  if (linkRef && (await steps.fetchInvitationLinkState(linkRef)) === 'cancelled') return 'cancelled'
  return (await steps.startPasswordRecovery(hash)) ? 'ready' : 'invalid'
}
