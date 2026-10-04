import type { Ref } from 'react'
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

        {/* Signed-in admin (display only) */}
        <div className="ml-auto flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-maroon text-sm font-semibold text-offwhite"
          >
            {user.initials}
          </span>
          <div className="leading-tight">
            <p className="text-sm font-medium text-maroon">{user.name}</p>
            <p className="text-xs text-text-gray">{content.roleLabel}</p>
          </div>
        </div>
      </div>
    </header>
  )
}
