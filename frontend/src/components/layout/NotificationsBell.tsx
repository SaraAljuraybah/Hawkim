import { useEffect, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
  MailWarning,
  MessageSquareReply,
  Undo2,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { notificationsEn } from '../../content/notifications.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import { Button } from '../ui/Button'
import type { NotificationType } from '../../lib/notifications'
import { isReadOnlyDepartment, needsHomeDepartment } from '../../lib/departmentNavigation'
import { formatRelativeTime, formatReviewDate, formatReviewDateTime } from '../../lib/format'
import { resendMessage } from '../../lib/invitations'
import { resendInvitation } from '../../services/invitations'
import { useActiveDepartment } from '../../state/activeDepartmentContext'
import { useDepartments } from '../../state/departmentsContext'
import { useNotifications, type NotificationItem } from '../../state/notificationsContext'
import { useCurrentUser } from '../../state/sessionContext'
import { useUsers } from '../../state/usersContext'

/** Most recent notifications listed (the list scrolls inside the panel). */
const MAX_ITEMS = 20

const ICONS: Record<NotificationType, LucideIcon> = {
  'assigned-review': ListChecks,
  'internal-review-completed': CircleCheck,
  'review-declined': CircleX,
  'review-withdrawn': AlarmClock,
  'review-expired': AlarmClock,
  'reviewer-removed': CircleX,
  'review-completed': CircleCheck,
  'review-returned': Undo2,
  'review-overdue': AlarmClock,
  'assigned-approval': ListChecks,
  'ready-to-publish': Upload,
  'sop-returned': Undo2,
  response: MessageSquareReply,
  'review-deadline-changed': Clock,
  'review-duration-changed': Clock,
  'sop-approved': BadgeCheck,
  'sop-published': BookOpen,
  'due-soon': Clock,
  overdue: AlarmClock,
  'request-approved': CircleCheck,
  'request-rejected': CircleX,
  'invitation-expired': MailWarning,
}

const iconButton =
  'inline-flex size-10 items-center justify-center rounded-lg border border-beige text-maroon transition-colors hover:bg-beige'

/**
 * The staff portal's notifications bell (PBI 31). A page hidden in a read-only department opens in the
 * home department.
 */
export function NotificationsBell() {
  const user = useCurrentUser()
  const { activeDepartment, homeDepartment, setActiveDepartment } = useActiveDepartment()
  const navigate = useNavigate()
  return (
    <NotificationsBellPanel
      onOpenLink={(link) => {
        if (needsHomeDepartment(link, isReadOnlyDepartment(activeDepartment.id, user))) setActiveDepartment(homeDepartment.id)
        void navigate(link)
      }}
    />
  )
}

/** The admin portal's notifications bell: the same bell, with the Admins' expired invitations. */
export function AdminNotificationsBell() {
  const navigate = useNavigate()
  return <NotificationsBellPanel onOpenLink={(link) => void navigate(link)} />
}

/**
 * The notifications bell: an unread count on the button and, when opened, a panel (disclosure
 * pattern) with the newest notifications. Clicking one marks it read and opens what it's about.
 * An expired invitation also has a Resend invitation button beside it (never inside it).
 * Escape or a click outside closes the panel.
 */
function NotificationsBellPanel({ onOpenLink }: { onOpenLink: (link: string) => void }) {
  const text = notificationsEn
  const { notifications, unreadCount, now, markRead, markAllRead, refreshInvitations } = useNotifications()
  const { nameOf } = useUsers()
  const { nameOf: departmentName } = useDepartments()
  const [open, setOpen] = useState(false)
  // Resend invitation: whose is being sent, and the last outcome (shown and announced in the panel).
  const [sending, setSending] = useState<string>()
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string }>()
  const outcomeRef = useRef<HTMLParagraphElement>(null)
  const listId = useId()
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
        .replace('{title}', item.sopTitle ?? '')
        .replace('{version}', item.version ?? '')
        .replace('{reason}', item.reason ?? '')
    switch (item.type) {
      case 'internal-review-completed': return fill(t.internalReviewCompleted)
      case 'review-declined': return fill(t.reviewDeclined)
      case 'review-withdrawn': return fill(item.forReviewer ? t.reviewWithdrawn.reviewer : t.reviewWithdrawn.author)
      case 'review-expired': return fill(item.forReviewer ? t.reviewExpired.reviewer : t.reviewExpired.author)
      case 'reviewer-removed': return fill(item.forReviewer ? t.reviewerRemovedClosed : t.reviewerRemoved)
      case 'review-completed': return fill(t.reviewCompleted)
      case 'review-returned': return fill(t.reviewReturned)
      case 'review-overdue': return fill(t.reviewOverdue)
      case 'assigned-review':
        return fill(item.via === 'handoff' ? t.handoff : item.via === 'routed' ? t.routed : item.via === 'resubmitted' ? t.resubmitted : item.via === 'resent' ? t.resent : t.submitted)
      case 'assigned-approval':
        return fill(t.assignedApproval)
      case 'ready-to-publish':
        return fill(t.readyToPublish)
      case 'sop-returned':
        return fill(t.returned)
      case 'response':
        return fill(t.response)
      case 'review-deadline-changed':
        return fill(t.reviewDeadlineChanged).replace('{date}', item.dueAt ? formatReviewDate(item.dueAt) : '')
      case 'review-duration-changed':
        return fill(t.reviewDurationChanged).replace('{days}', item.reviewDurationDays === 1 ? sopWorkflowEn.timeline.durationDay
          : sopWorkflowEn.timeline.durationDays.replace('{count}', String(item.reviewDurationDays ?? '')))
      case 'sop-approved':
        return fill(t.approved)
      case 'sop-published':
        return fill(t.published)
      case 'due-soon': {
        // Within 24 hours: today, or tomorrow (local dates).
        const today = new Date(now).toDateString() === new Date(item.dueAt ?? '').toDateString()
        // An internal request not yet accepted is reminded to accept or decline before it expires.
        return fill(item.phase === 'response' ? t.dueSoon.response : t.dueSoon[item.stage ?? 'review']).replace('{day}', today ? t.days.today : t.days.tomorrow)
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
      case 'invitation-expired':
        return text.invitations.expired
          .replace('{name}', item.invitation?.name ?? '')
          .replace('{email}', item.invitation?.email ?? '')
          .replace('{date}', item.invitation ? formatReviewDateTime(item.invitation.expiredAt) : '')
    }
  }
  function openItem(item: NotificationItem) {
    markRead(item.id)
    setOpen(false)
    onOpenLink(item.link)
  }
  function toggle() {
    // Expired invitations are read again each time the panel opens.
    if (!open) {
      setOutcome(undefined)
      void refreshInvitations()
    }
    setOpen(!open)
  }
  async function resend(invitation: NonNullable<NotificationItem['invitation']>) {
    setSending(invitation.userId)
    setOutcome(undefined)
    const result = await resendInvitation(invitation.userId)
    const message = resendMessage(result, invitation)
    // Resent, activated or deleted: the list changes, so read it again before saying so.
    await refreshInvitations()
    flushSync(() => {
      setSending(undefined)
      setOutcome({ ok: result.ok, message })
    })
    // The item may be gone: keep focus in the panel, on the message.
    outcomeRef.current?.focus()
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
        onClick={toggle}
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
        {/* The outcome of Resend invitation: success is announced politely, a failure at once. Both regions stay mounted. */}
        <div role="status">
          {outcome?.ok && (
            <p ref={outcomeRef} tabIndex={-1} className="border-b border-beige bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg focus:outline-none">
              {outcome.message}
            </p>
          )}
        </div>
        <div role="alert">
          {outcome && !outcome.ok && (
            <p ref={outcomeRef} tabIndex={-1} className="border-b border-beige bg-status-rejected-bg px-4 py-3 text-sm font-medium text-status-rejected-fg focus:outline-none">
              {outcome.message}
            </p>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-gray">{text.empty}</p>
        ) : (
          <ul aria-labelledby={titleId} className="max-h-[min(28rem,calc(100dvh-9rem))] divide-y divide-beige overflow-y-auto">
            {shown.map((item, index) => {
              const Icon = ICONS[item.type]
              const textId = `${listId}-${index}`
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
                      <span id={textId} className={`block text-sm leading-snug text-maroon ${item.read ? '' : 'font-medium'}`}>
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
                  {/* Beside the item's button, not inside it: its own control, described by the notification's text.
                      Lined up with the text (1rem padding + 2rem icon + 0.75rem gap). */}
                  {item.invitation && (
                    <div className={`px-4 pb-3 pl-[3.75rem] ${item.read ? '' : 'bg-maroon/[0.03]'}`}>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={sending === item.invitation.userId ? text.invitations.sending : text.invitations.resendLabel.replace('{name}', item.invitation.name)}
                        aria-describedby={textId}
                        disabled={sending !== undefined}
                        onClick={() => { if (item.invitation) void resend(item.invitation) }}
                      >
                        {sending === item.invitation.userId ? text.invitations.sending : text.invitations.resend}
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
