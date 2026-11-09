import type { ReactNode } from 'react'
import type { User } from '../../data/mock/types'
import { DeleteUserButton } from './DeleteUserButton'
import { PermissionBadges, UserAvatar } from './UserBits'

/**
 * The header of a staff member's page and Edit Staff: large avatar, the name as the page's h1 with
 * Delete right beside it (after any `actions`, e.g. Edit Staff), and the saved permissions as badges
 * under it (none without one). `label` (e.g. "Edit Staff") is a small line above the name, inside the
 * h1 so the heading says the page's purpose too. The name wraps on narrow screens; the buttons stay
 * beside its first line.
 */
export function UserHeader({
  user,
  label,
  actions,
  onDeleted,
  onRefused,
}: {
  user: User
  label?: string
  /** Buttons before Delete, beside the name. */
  actions?: ReactNode
  onDeleted: (message: string) => void
  onRefused: (title: string, reasons: string[]) => void
}) {
  return (
    <div className="mt-5 flex items-start gap-4">
      <UserAvatar user={user} className="size-14 text-base" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 text-2xl break-words tracking-tight sm:text-3xl">
            {/* The space keeps "Edit User" and the name apart for screen readers */}
            {label && <><span className="block text-sm font-medium tracking-normal text-text-gray">{label}</span>{' '}</>}
            {user.name}
          </h1>
          {/* Below the label's line (1.25rem), so they sit beside the name */}
          <div className={`flex shrink-0 items-center gap-2 ${label ? 'mt-5' : ''}`}>
            {actions}
            <DeleteUserButton user={user} onDeleted={onDeleted} onRefused={onRefused} />
          </div>
        </div>
        <PermissionBadges user={user} className="mt-2" />
      </div>
    </div>
  )
}
