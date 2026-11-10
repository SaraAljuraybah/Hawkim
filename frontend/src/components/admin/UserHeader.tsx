import type { ReactNode } from 'react'
import type { User } from '../../data/mock/types'
import { DeleteUserButton } from './DeleteUserButton'
import { usersEn } from '../../content/users.en'
import { UserAvatar } from './UserBits'

/**
 * The header of a staff member's page and Edit Staff: large avatar, the name as the page's h1 with
 * Delete right beside it (after any `actions`, e.g. Edit Staff), and the saved permissions as badges
 * under it (none without one). `label` (e.g. "Edit Staff") is a small line above the name, inside the
 * h1 so the heading says the page's purpose too. `description` is one short line under the badges.
 * The name wraps on narrow screens; the buttons stay beside its first line.
 *
 * The badges here use Hawkim's solid light gold with maroon text (8.84:1, as in the sidebar's
 * count badges), so the permissions read clearly on a staff member's own page. The Staff list keeps
 * the lighter shared PermissionBadges.
 */
export function UserHeader({
  user,
  label,
  description,
  actions,
  onDeleted,
  onRefused,
}: {
  user: User
  label?: string
  /** One short line under the name and badges. */
  description?: string
  /** Buttons before Delete, beside the name. */
  actions?: ReactNode
  onDeleted: (message: string) => void
  onRefused: (title: string, reasons: string[]) => void
}) {
  return (
    // On phones the avatar and the name are a step smaller, so a long first name fits beside the buttons
    // instead of breaking mid-word; from sm up, as before.
    <div className="mt-5 flex items-start gap-3 sm:gap-4">
      <UserAvatar user={user} className="size-10 text-sm sm:size-14 sm:text-base" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 text-xl break-words tracking-tight sm:text-3xl">
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
        {user.permissions.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {user.permissions.map((permission) => (
              <li
                key={permission}
                className="inline-flex items-center rounded-md bg-gold-light px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-maroon"
              >
                {usersEn.permissions[permission]}
              </li>
            ))}
          </ul>
        )}
        {description && <p className="mt-2 text-text-gray">{description}</p>}
      </div>
    </div>
  )
}
