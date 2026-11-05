import { usersEn } from '../../content/users.en'
import type { User } from '../../data/mock/types'

export { UserAvatar } from '../ui/UserAvatar'

/**
 * The user's permissions as text badges, or "Employee" when they have none. Same gold accent as
 * the "Admin" badge in the admin sidebar (light gold, maroon text: 8.84:1), with a gold border so
 * it stands out on white.
 */
export function PermissionBadges({ user, className = '' }: { user: Pick<User, 'permissions'>; className?: string }) {
  const badge = 'inline-flex items-center rounded-full border border-gold bg-gold-light px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-maroon'
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
