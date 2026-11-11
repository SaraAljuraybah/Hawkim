import type { ReactNode } from 'react'
import type { User } from '../../data/mock/types'
import { CopyButton } from '../ui/CopyButton'
import { UserAvatar } from './UserBits'

/**
 * The parts shared by a staff member's page and an Admin's page, so the two look the same:
 *
 * - DetailsHeader: the avatar, the name as the page's h1 and a badge (permissions or role) under it on
 *   the left; the actions at the top right. When the name needs the room (a long name, a phone) the
 *   actions move to their own line under it, so the name stays readable and nothing overflows.
 * - DetailsCard and DetailRow: the white Details card. Labels are 14px bold maroon, values 16px regular
 *   maroon (15.9:1 on white); label above value on phones, side by side from sm, with a thin divider
 *   between rows.
 * - EmailDetail: the address with its copy icon right after it.
 */
export function DetailsHeader({ user, badges, actions }: { user: User; badges?: ReactNode; actions?: ReactNode }) {
  return (
    // The name block grows from its full width (flex-auto), so the actions stay at the top right while the
    // name fits on one line beside them, and otherwise move to their own line under it.
    <div className="mt-5 flex flex-wrap items-start gap-x-3 gap-y-4 sm:gap-x-4">
      <div className="flex min-w-0 flex-auto items-start gap-3 sm:gap-4">
        <UserAvatar user={user} className="size-10 text-sm sm:size-14 sm:text-base" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl break-words tracking-tight sm:text-3xl">{user.name}</h1>
          {badges && <div className="mt-2 flex flex-wrap">{badges}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function DetailsCard({ id, title, children, footer }: { id: string; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mt-6 grid max-w-3xl gap-6">
      <section aria-labelledby={id} className="rounded-xl border border-beige bg-white p-5 sm:p-6">
        <h2 id={id} className="text-lg">
          {title}
        </h2>
        <dl className="mt-4 divide-y divide-beige">{children}</dl>
        {footer}
      </section>
    </div>
  )
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-baseline sm:gap-6">
      <dt className="text-sm font-bold text-maroon">{label}</dt>
      <dd className="min-w-0 text-base break-words text-maroon">{children}</dd>
    </div>
  )
}

/** The address and its copy icon stay together; the confirmation takes its own line. */
export function EmailDetail({ email, copyLabel, copiedText, failedText }: { email: string; copyLabel: string; copiedText: string; failedText: string }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
      <span className="min-w-0 break-all">{email}</span>
      <CopyButton text={email} label={copyLabel} copiedText={copiedText} failedText={failedText} />
    </span>
  )
}

/** A staff member's permissions as solid light-gold badges with maroon text (8.84:1). */
export function StaffPermissionBadges({ labels, className = '' }: { labels: string[]; className?: string }) {
  if (labels.length === 0) return null
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`}>
      {labels.map((label) => (
        <li key={label} className="inline-flex items-center rounded-md bg-gold-light px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-maroon">
          {label}
        </li>
      ))}
    </ul>
  )
}
