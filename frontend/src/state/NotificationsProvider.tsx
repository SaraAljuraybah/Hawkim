import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { deriveNotifications, isRead } from '../lib/notifications'
import { NotificationsContext, type NotificationsStore } from './notificationsContext'
import { useRequests } from './requestsContext'
import { useSession } from './sessionContext'
import { useSops } from './sopsContext'

/** Due-soon and overdue are recalculated this often. */
const TICK_MS = 60 * 1000

/**
 * In-app notifications (PBI 31), derived from the SOPs and requests stores (see
 * lib/notifications.ts). Only the read state is kept, per user and in memory; like
 * the rest of the sample data it resets on reload. Everything that happened before
 * the app loaded counts as read, except due-soon and overdue notifications.
 * TODO: Email notifications will be sent by the backend for the same events (it
 * needs the users' email settings and a mail service); nothing is emailed from here.
 * Must be inside <SessionProvider>, <RequestsProvider> and <SopsProvider>.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const user = useSession().user
  const { sops } = useSops()
  const { requests } = useRequests()
  const [sessionStartedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [readByUser, setReadByUser] = useState<Record<string, string[]>>({})

  // Recalculate due-soon and overdue every minute. (The demo panel's clock control
  // moves due dates, which changes the SOPs and recalculates at once.)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  const userId = user?.id
  const notifications = useMemo(() => {
    if (!userId) return []
    const readIds = new Set(readByUser[userId] ?? [])
    return deriveNotifications(userId, { sops, requests, now }).map((notification) => ({
      ...notification,
      read: isRead(notification, readIds, sessionStartedAt),
    }))
  }, [userId, sops, requests, now, readByUser, sessionStartedAt])

  const markIds = useCallback(
    (ids: string[]) => {
      if (!userId || ids.length === 0) return
      setReadByUser((current) => ({ ...current, [userId]: [...new Set([...(current[userId] ?? []), ...ids])] }))
    },
    [userId],
  )
  const markRead = useCallback((id: string) => markIds([id]), [markIds])
  const markAllRead = useCallback(
    () => markIds(notifications.filter((item) => !item.read).map((item) => item.id)),
    [markIds, notifications],
  )

  const store = useMemo<NotificationsStore>(
    () => ({
      notifications,
      unreadCount: notifications.filter((item) => !item.read).length,
      now,
      markRead,
      markAllRead,
    }),
    [notifications, now, markRead, markAllRead],
  )

  return <NotificationsContext.Provider value={store}>{children}</NotificationsContext.Provider>
}
