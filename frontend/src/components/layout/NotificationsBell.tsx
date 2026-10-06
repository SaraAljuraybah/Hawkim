import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlarmClock,
  BadgeCheck,
  Bell,
  BookOpen,
  CircleCheck,
  CircleX,
  Clock,
  ListChecks,
  Undo2,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { notificationsEn } from '../../content/notifications.en'
import type { NotificationType } from '../../lib/notifications'
import { formatRelativeTime } from '../../lib/format'
import { useDepartments } from '../../state/departmentsContext'
import { useNotifications, type NotificationItem } from '../../state/notificationsContext'
import { useUsers } from '../../state/usersContext'

/** Most recent notifications listed (the list scrolls inside the panel). */
const MAX_ITEMS = 20

const ICONS: Record<NotificationType, LucideIcon> = {
  'assigned-review': ListChecks,
  'assigned-approval': ListChecks,
  'ready-to-publish': Upload,
  'sop-returned': Undo2,
  'sop-approved': BadgeCheck,
  'sop-published': BookOpen,
  'due-soon': Clock,
  overdue: AlarmClock,
  'request-approved': CircleCheck,
  'request-rejected': CircleX,
}

const iconButton =
  'inline-flex size-10 items-center justify-center rounded-lg border border-beige text-maroon transition-colors hover:bg-beige'

/**
 * The notifications bell (PBI 31): an unread count on the button and, when opened, a
 * panel (disclosure pattern) with the newest notifications. Clicking one marks it
 * read and opens what it's about. Escape or a click outside closes the panel.
 */
export function NotificationsBell() {
  const text = notificationsEn
  const { notifications, unreadCount, now, markRead, markAllRead } = useNotifications()
  const { nameOf } = useUsers()
  const { nameOf: departmentName } = useDepartments()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const titleId = useId()

  // Escape or a click outside closes the panel and returns focus to the bell.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    function onPointerDown(event: PointerEvent) {
      if (wrapperRef.current?.contains(event.target as Node)) return
      // Only take focus back if it was in the panel (don't steal it from what was clicked).
      const focusInside = wrapperRef.current?.contains(document.activeElement)
      setOpen(false)
      if (focusInside) buttonRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  function textOf(item: NotificationItem): string {
    const t = text.texts
    const fill = (template: string) =>
      template
        .replace('{name}', nameOf(item.actorId))
        .replace('{code}', item.sopCode ?? '')
        .replace('{version}', item.version ?? '')
    switch (item.type) {
      case 'assigned-review':
        return fill(item.via === 'routed' ? t.routed : item.via === 'resubmitted' ? t.resubmitted : t.submitted)
      case 'assigned-approval':
        return fill(t.assignedApproval)
      case 'ready-to-publish':
        return fill(t.readyToPublish)
      case 'sop-returned':
        return fill(t.returned)
      case 'sop-approved':
        return fill(t.approved)
      case 'sop-published':
        return fill(t.published)
      case 'due-soon': {
        // Within 24 hours: today, or tomorrow (local dates).
        const today = new Date(now).toDateString() === new Date(item.dueAt ?? '').toDateString()
        return fill(t.dueSoon[item.stage ?? 'review']).replace('{day}', today ? t.days.today : t.days.tomorrow)
      }
      case 'overdue':
        return fill(t.overdue[item.stage ?? 'review'])
      case 'request-approved':
      case 'request-rejected': {
        const decision = item.type === 'request-approved' ? 'approved' : 'rejected'
        return item.request?.type === 'department-access'
          ? t.accessRequest[decision].replace('{department}', departmentName(item.request.departmentId))
          : t.request[decision].replace('{title}', item.request?.title ?? '')
      }
    }
  }

  function openItem(item: NotificationItem) {
    markRead(item.id)
    setOpen(false)
    navigate(item.link)
  }

  const shown = notifications.slice(0, MAX_ITEMS)
  const badge = unreadCount > 9 ? '9+' : String(unreadCount)

  return (
    <div ref={wrapperRef} className="relative flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label={unreadCount > 0 ? text.bellLabelUnread.replace('{count}', String(unreadCount)) : text.bellLabel}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={`relative ${iconButton}`}
      >
        <Bell aria-hidden="true" className="size-5" strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -right-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-maroon px-1 text-[0.6875rem] leading-none font-semibold text-offwhite ring-2 ring-white"
          >
            {badge}
          </span>
        )}
      </button>

      {/* Full width under the top bar on phones; a dropdown from sm up */}
      <div
        id={panelId}
        hidden={!open}
        className="fixed inset-x-0 top-16 z-40 border-y border-beige bg-white shadow-lg sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96 sm:rounded-xl sm:border"
      >
        <div className="flex items-center justify-between gap-3 border-b border-beige px-4 py-3">
          <h2 id={titleId} className="text-base">
            {text.title}
          </h2>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="rounded-sm text-sm font-medium text-maroon underline-offset-2 hover:underline"
            >
              {text.markAllRead}
            </button>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-gray">{text.empty}</p>
        ) : (
          <ul aria-labelledby={titleId} className="max-h-[min(28rem,calc(100dvh-9rem))] divide-y divide-beige overflow-y-auto">
            {shown.map((item) => {
              const Icon = ICONS[item.type]
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-beige/50 focus-visible:-outline-offset-2 ${
                      item.read ? '' : 'bg-maroon/[0.03]'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-maroon/[0.07] text-maroon"
                    >
                      <Icon className="size-4" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm leading-snug text-maroon ${item.read ? '' : 'font-medium'}`}>
                        {textOf(item)}
                      </span>
                      <time dateTime={item.createdAt} className="mt-0.5 block text-xs text-text-gray">
                        {formatRelativeTime(item.createdAt, now, text.justNow)}
                      </time>
                    </span>
                    {!item.read && (
                      <span className="mt-1.5 shrink-0">
                        <span aria-hidden="true" className="block size-2 rounded-full bg-maroon" />
                        <span className="sr-only">{text.unread}</span>
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
