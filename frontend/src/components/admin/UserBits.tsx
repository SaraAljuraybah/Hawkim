import { usersEn } from '../../content/users.en'
import type { User } from '../../data/mock/types'

export { UserAvatar } from '../ui/UserAvatar'

/**
 * The user's permissions as text badges, or "Employee" when they have none: the admin sidebar's
 * "Admin" tag, with its light gold at 60% so it is lighter on white (maroon text on it: 11.63:1).
 */
export function PermissionBadges({ user, className = '' }: { user: Pick<User, 'permissions'>; className?: string }) {
  const badge = 'inline-flex items-center rounded-md bg-gold-light/60 px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap text-maroon'
  const labels = user.permissions.length === 0 ? [usersEn.employee] : user.permissions.map((permission) => usersEn.permissions[permission])
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`}>
      {labels.map((label) => (
        <li key={label} className={badge}>
          {label}
        </li>
      ))}
    </ul>
  )
}
