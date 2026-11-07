import type { Ref } from 'react'
import { Link } from 'react-router-dom'
import { Menu } from 'lucide-react'
import type { AdminShellContent } from '../../content/types'
import type { User } from '../../data/mock/types'

interface AdminTopBarProps {
  content: AdminShellContent
  user: User
  menuOpen: boolean
  onOpenMenu: () => void
  /** Ref to the menu button, so focus can return to it when the drawer closes. */
  menuButtonRef: Ref<HTMLButtonElement>
}

/** Top bar of the admin portal: menu button (small screens) and the admin's name and role. */
export function AdminTopBar({ content, user, menuOpen, onOpenMenu, menuButtonRef }: AdminTopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-beige bg-white/90 backdrop-blur-md print:hidden">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onOpenMenu}
          aria-label={content.openMenu}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          className="inline-flex size-10 items-center justify-center rounded-lg border border-beige text-maroon transition-colors hover:bg-beige lg:hidden"
        >
          <Menu aria-hidden="true" className="size-5" strokeWidth={1.75} />
        </button>

        {/* Signed-in admin: the avatar is the link to their profile, as in the employee top bar */}
        <div className="ml-auto flex items-center gap-3">
          <Link
            to={content.profileLink.href}
            aria-label={content.profileLink.label.replace('{name}', user.name)}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-maroon text-sm font-semibold text-offwhite transition-colors hover:bg-maroon-secondary"
          >
            <span aria-hidden="true">{user.initials}</span>
          </Link>
          <div className="leading-tight">
            {/* The same link for the mouse and touch. Screen readers and the keyboard use the avatar's, so they don't meet it twice. */}
            <Link
              to={content.profileLink.href}
              tabIndex={-1}
              aria-hidden="true"
              className="block text-sm font-medium text-maroon underline-offset-2 outline-none hover:underline"
            >
              {user.name}
            </Link>
            <p className="text-xs text-text-gray">{content.roleLabel}</p>
          </div>
        </div>
      </div>
    </header>
  )
}
