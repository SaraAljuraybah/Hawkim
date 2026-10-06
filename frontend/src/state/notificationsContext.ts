import { createContext, useContext } from 'react'
import type { AppNotification } from '../lib/notifications'

export interface NotificationItem extends AppNotification {
  read: boolean
}

export interface NotificationsStore {
  /** The signed-in user's notifications, newest first, with their read state. */
  notifications: NotificationItem[]
  unreadCount: number
  /** The time used for "due soon", "overdue" and relative times (updated every minute). */
  now: number
  markRead: (id: string) => void
  markAllRead: () => void
}

export const NotificationsContext = createContext<NotificationsStore | null>(null)

/** Access the notifications. Must be used inside <NotificationsProvider>. */
export function useNotifications(): NotificationsStore {
  const store = useContext(NotificationsContext)
  if (!store) throw new Error('useNotifications must be used inside <NotificationsProvider>')
  return store
}
