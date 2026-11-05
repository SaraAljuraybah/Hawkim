import { usersEn } from '../../content/users.en'
import type { User } from '../../data/mock/types'

export { UserAvatar } from '../ui/UserAvatar'

/** The user's permissions as text badges, or "Employee" when they have none. */
export function PermissionBadges({ user, className = '' }: { user: Pick<User, 'permissions'>; className?: string }) {
  const badge = 'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap'
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`}>
      {user.permissions.length === 0 ? (
        <li className={`${badge} border-text-gray/30 text-text-gray`}>{usersEn.employee}</li>
      ) : (
        user.permissions.map((permission) => (
          <li key={permission} className={`${badge} border-maroon/20 bg-maroon/[0.06] text-maroon`}>
            {usersEn.permissions[permission]}
          </li>
        ))
      )}
    </ul>
  )
}
