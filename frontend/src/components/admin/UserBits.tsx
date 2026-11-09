import { usersEn } from '../../content/users.en'
import type { User } from '../../data/mock/types'

export { UserAvatar } from '../ui/UserAvatar'

/**
 * The user's permissions as text badges, or nothing when they have none. On white the light gold
 * is at 60% so it is lighter (maroon text on it: 11.63:1). In the maroon `sidebar` it is solid
 * (maroon text on it: 8.84:1) and the badges flow inline after the product name, so only those
 * that don't fit wrap onto the next line.
 */
export function PermissionBadges({
  user,
  className = '',
  sidebar = false,
  label,
}: {
  user: Pick<User, 'permissions'>
  className?: string
  sidebar?: boolean
  /** Accessible name of the list. */
  label?: string
}) {
  const badge = `inline-flex items-center rounded-md ${sidebar ? 'mr-1 bg-gold-light align-middle text-[0.6875rem] leading-4' : 'bg-gold-light/60 text-xs'} px-1.5 py-0.5 font-semibold whitespace-nowrap text-maroon`
  if (user.permissions.length === 0) return null
  const labels = user.permissions.map((permission) => usersEn.permissions[permission])
  return (
    <ul aria-label={label} className={`${sidebar ? 'inline' : 'flex flex-wrap gap-1.5'} ${className}`}>
      {labels.map((label) => (
        <li key={label} className={badge}>
          {label}
        </li>
      ))}
    </ul>
  )
}
