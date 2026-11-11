import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { invitationNotifications } from '../../lib/notifications'
import type { NotificationItem } from '../../state/notificationsContext'
import { AdminNotificationsBell, NotificationsBell } from './NotificationsBell'

const state = vi.hoisted(() => ({ items: [] as NotificationItem[] }))
vi.mock('../../state/notificationsContext', () => ({
  useNotifications: () => ({
    notifications: state.items, unreadCount: state.items.filter((item) => !item.read).length, now: Date.parse('2026-11-11T12:00:00Z'),
    markRead: vi.fn(), markAllRead: vi.fn(), refreshInvitations: vi.fn(async () => {}),
  }),
}))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ nameOf: () => 'Someone' }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ nameOf: () => 'A department' }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => ({ id: 'me', departmentId: 'home', permissions: ['author'] }) }))
vi.mock('../../state/activeDepartmentContext', () => ({
  useActiveDepartment: () => ({ activeDepartment: { id: 'home' }, homeDepartment: { id: 'home' }, setActiveDepartment: vi.fn() }),
}))

const invitation = invitationNotifications('me', [
  { userId: 'u-rana', name: 'Rana Saleh', email: 'rana@example.test', kind: 'staff', sentAt: '2026-11-09T08:00:00.000Z', expiredAt: '2026-11-10T08:00:00.000Z' },
])[0]
const requestItem: NotificationItem = {
  id: 'r1:approved:me', type: 'request-approved', createdAt: '2026-11-10T09:00:00.000Z', link: '/requests', read: true,
  request: { title: 'More access', type: 'permission-change', departmentId: 'home' },
}
const render = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
const items = (html: string) => [...html.matchAll(/<li>(.*?)<\/li>/g)].map((match) => match[1])

describe('the admin portal’s bell with an expired invitation', () => {
  it('says whose link expired, when (Riyadh time), and what to do', () => {
    state.items = [{ ...invitation, read: false }]
    const html = render(<AdminNotificationsBell />)
    expect(html).toContain('Invitation expired. The activation link for Rana Saleh (rana@example.test) expired on Nov 10, 2026, 11:00 AM GMT+3. Resend the invitation so they can set their password.')
    expect(html).toContain('aria-label="Notifications, 1 unread"')
    expect(html).toContain('lucide-mail-warning')
  })

  it('puts Resend invitation beside the item’s button, never inside it, named and described for screen readers', () => {
    state.items = [{ ...invitation, read: false }]
    const [item] = items(render(<AdminNotificationsBell />))
    const buttons = [...item.matchAll(/<button[^>]*>/g)].map((match) => match[0])
    expect(buttons).toHaveLength(2)
    // The item's button is closed before Resend starts: no nested interactive elements.
    expect(item.indexOf('</button>')).toBeLessThan(item.indexOf('aria-label="Resend invitation to Rana Saleh"'))
    expect(item).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<button/)
    const describedBy = buttons[1].match(/aria-describedby="([^"]+)"/)![1]
    expect(item).toContain(`<span id="${describedBy}"`)
    expect(item).toMatch(/aria-label="Resend invitation to Rana Saleh"[^>]*>Resend invitation<\/button>/)
    expect(buttons[1]).toContain('type="button"')
    expect(buttons[1]).not.toContain(' disabled=""')
  })

  it('has the regions that announce the outcome, there before any Resend', () => {
    state.items = [{ ...invitation, read: false }]
    expect(render(<AdminNotificationsBell />)).toContain('<div role="status"></div><div role="alert"></div>')
  })

  it('stays listed once marked read, with Resend still offered', () => {
    state.items = [{ ...invitation, read: true }]
    const html = render(<AdminNotificationsBell />)
    expect(html).toContain('aria-label="Notifications"')
    expect(html).toContain('aria-label="Resend invitation to Rana Saleh"')
  })
})

describe('the staff portal’s bell (unchanged)', () => {
  it('lists the same notifications as before, with no Resend button', () => {
    state.items = [requestItem]
    const html = render(<NotificationsBell />)
    expect(html).toContain('Your request “More access” was approved')
    expect(html).not.toContain('Resend invitation')
    expect(items(html).map((item) => [...item.matchAll(/<button/g)].length)).toEqual([1])
  })
})
