import type { Ref } from 'react'
import { Bell, Menu } from 'lucide-react'
import type { AppShellContent } from '../../content/types'
import type { User } from '../../data/mock/types'

interface TopBarProps {
  content: AppShellContent
  user: User
  menuOpen: boolean
  onOpenMenu: () => void
  /** Ref to the menu button, so focus can return to it when the drawer closes. */
  menuButtonRef: Ref<HTMLButtonElement>
}

const iconButton =
  'inline-flex size-10 items-center justify-center rounded-lg border border-beige text-maroon transition-colors hover:bg-beige'

/** Top bar of the signed-in app: menu button (small screens), notifications and user. */
export function TopBar({ content, user, menuOpen, onOpenMenu, menuButtonRef }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-beige bg-white/90 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onOpenMenu}
          aria-label={content.openMenu}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          className={`${iconButton} lg:hidden`}
        >
          <Menu aria-hidden="true" className="size-5" strokeWidth={1.75} />
        </button>

        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          {/* TODO: Notifications panel, unread indicator and count (not built yet). */}
          <button type="button" aria-label={content.notificationsLabel} className={iconButton}>
            <Bell aria-hidden="true" className="size-5" strokeWidth={1.75} />
          </button>

          <span aria-hidden="true" className="h-8 w-px bg-beige" />

          {/* Current user (display only — not a menu yet) */}
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-maroon text-sm font-semibold text-offwhite"
            >
              {user.initials}
            </span>
            {/* On very small screens only the initials are visible; the text stays available to screen readers */}
            <div className="sr-only leading-tight sm:not-sr-only">
              <p className="text-sm font-medium text-maroon">{user.name}</p>
              <p className="text-xs text-text-gray">{user.department}</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
