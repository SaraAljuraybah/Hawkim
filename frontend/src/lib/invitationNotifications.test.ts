import { describe, expect, it } from 'vitest'
import type { ExpiredInvitation } from '../services/invitations'
import { resendMessage } from './invitations'
import { deriveNotifications, invitationNotifications, isRead } from './notifications'

const rana: ExpiredInvitation = { userId: 'u-rana', name: 'Rana Saleh', email: 'rana@example.test', kind: 'staff', sentAt: '2026-11-09T08:00:00.000Z', expiredAt: '2026-11-10T08:00:00.000Z' }
const omar: ExpiredInvitation = { userId: 'u-omar', name: 'Omar Ali', email: 'omar@example.test', kind: 'admin', sentAt: '2026-11-09T09:00:00.000Z', expiredAt: '2026-11-10T09:00:00.000Z' }

describe('expired-invitation notifications', () => {
  it('has one per invitation, opening the person’s Staff or Admin page', () => {
    const [staff, admin] = invitationNotifications('me', [rana, omar])
    expect(staff).toMatchObject({
      type: 'invitation-expired', link: '/admin/users/u-rana', createdAt: rana.expiredAt, unresolved: true,
      invitation: { userId: 'u-rana', name: 'Rana Saleh', email: 'rana@example.test', expiredAt: rana.expiredAt },
    })
    expect(admin.link).toBe('/admin/admins/u-omar')
  })

  it('gets a new id for each sending, so a resent link that expires again is a new notification', () => {
    const [first] = invitationNotifications('me', [rana])
    const [again] = invitationNotifications('me', [{ ...rana, sentAt: '2026-11-10T10:00:00.000Z', expiredAt: '2026-11-11T10:00:00.000Z' }])
    expect(again.id).not.toBe(first.id)
  })

  it('stays unread until marked read, however long ago it expired (Mark All as Read only marks it read)', () => {
    const [item] = invitationNotifications('me', [rana])
    const sessionStartedAt = Date.parse('2026-11-11T00:00:00Z')
    expect(isRead(item, new Set(), sessionStartedAt)).toBe(false)
    expect(isRead(item, new Set([item.id]), sessionStartedAt)).toBe(true)
  })

  it('is listed with the other notifications, newest first', () => {
    const list = deriveNotifications('me', { sops: [], requests: [], now: Date.now(), invitations: [rana, omar] })
    expect(list.map((item) => item.invitation?.userId)).toEqual(['u-omar', 'u-rana'])
    expect(deriveNotifications('me', { sops: [], requests: [], now: Date.now() })).toEqual([])
  })
})

describe('what Resend invitation says', () => {
  it('says where the new link was sent', () => {
    expect(resendMessage({ ok: true, email: 'rana@example.test' }, rana)).toBe('Invitation sent to rana@example.test. The new link expires in 24 hours.')
  })

  it('says why nothing was sent, naming the person', () => {
    expect(resendMessage({ ok: false, reason: 'already-activated' }, rana)).toBe('Rana Saleh has already activated their account, so no invitation was sent.')
    expect(resendMessage({ ok: false, reason: 'still-valid' }, rana)).toBe('A new invitation was already sent to Rana Saleh, and its link is still valid.')
    expect(resendMessage({ ok: false, reason: 'not-found' }, rana)).toBe('Rana Saleh no longer has a Hawkim account, so no invitation was sent.')
    expect(resendMessage({ ok: false, reason: 'email-failed' }, rana)).toBe('The invitation email couldn’t be sent. Try again in a few minutes.')
    expect(resendMessage({ ok: false, reason: 'failed' }, rana)).toBe('The invitation couldn’t be resent. Check your connection and try again.')
  })
})
