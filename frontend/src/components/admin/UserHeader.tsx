import type { User } from '../../data/mock/types'
import { DeleteUserButton } from './DeleteUserButton'
import { PermissionBadges, UserAvatar } from './UserBits'

/**
 * The header of a user's page and Edit User: large avatar, the name as the page's h1 with Delete
 * user right beside it, and the saved permissions as badges under it (none without one). `label`
 * (e.g. "Edit User") is a small line above the name, inside the h1 so the heading says the page's
 * purpose too. The name wraps on narrow screens; Delete stays beside its first line.
 */
export function UserHeader({
  user,
  label,
  onDeleted,
  onRefused,
}: {
  user: User
  label?: string
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
          {/* Below the label's line (1.25rem), so it sits beside the name */}
          <div className={label ? 'mt-5' : undefined}>
            <DeleteUserButton user={user} onDeleted={onDeleted} onRefused={onRefused} />
          </div>
        </div>
        <PermissionBadges user={user} className="mt-2" />
      </div>
    </div>
  )
}
