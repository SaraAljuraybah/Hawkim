import type { User } from '../../data/mock/types'

/** The user's initials in a circle (decorative: the name is always shown next to it). */
export function UserAvatar({ user, className = '' }: { user: Pick<User, 'initials'>; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-beige text-xs font-semibold text-maroon ${className}`}
    >
      {user.initials}
    </span>
  )
}
