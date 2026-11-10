import type { Ref } from 'react'
import { Link } from 'react-router-dom'
import { Menu } from 'lucide-react'
import type { AppShellContent } from '../../content/types'
import type { User } from '../../data/mock/types'
import { isSystemAdmin } from '../../lib/userAdmin'
import { DepartmentSwitcher } from './DepartmentSwitcher'
import { NotificationsBell } from './NotificationsBell'

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
    <header className="sticky top-0 z-30 border-b border-beige bg-white/90 backdrop-blur-md print:hidden">
      {/* At least 64px; taller only when the user's details wrap on a narrow window */}
      <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8">
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

        <div className="ml-auto flex min-w-0 items-center gap-3 sm:gap-4">
          {/* Notifications (PBI 31): unread count and a panel with the newest ones */}
          <NotificationsBell />

          <span aria-hidden="true" className="h-8 w-px shrink-0 bg-beige" />

          {/* Current user: the avatar is the link to their profile; the department switcher stays separate.
              No fixed width and nothing truncated: the details size to their content and wrap when space runs out. */}
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to={content.profileLink.href}
              aria-label={content.profileLink.label.replace('{name}', user.name)}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-maroon text-sm font-semibold text-offwhite transition-colors hover:bg-maroon-secondary"
            >
              <span aria-hidden="true">{user.initials}</span>
            </Link>
            <div className="min-w-0 leading-tight">
              {/* The same link for the mouse and touch, hidden on phones. Screen readers and the
                  keyboard use the avatar's link, so they don't meet it twice. The department
                  switcher moves into the mobile drawer on phones. It never takes keyboard focus, so a
                  click shows no focus ring (which would cover the department line). */}
              <Link
                to={content.profileLink.href}
                tabIndex={-1}
                aria-hidden="true"
                className="hidden text-sm font-medium break-words text-maroon underline-offset-2 outline-none hover:underline sm:block"
              >
                {user.name}
              </Link>
              {/* "Department | Position" side by side on one line, never stacked: only a very long position
                  wraps within its own column. The department stays the switcher; the position is plain
                  text. An administrator has neither (and uses the admin portal's top bar, with only "Super
                  Admin" or "Admin"), so the line isn't shown for them. */}
              {!isSystemAdmin(user) && (
                <div className="hidden items-center gap-x-1.5 text-xs text-text-gray sm:flex">
                  <span className="shrink-0">
                    <DepartmentSwitcher content={content.departmentSwitcher} variant="topbar" />
                  </span>
                  {user.position && (
                    <>
                      <span aria-hidden="true" className="shrink-0 text-text-gray/60">{content.positionSeparator}</span>
                      <span className="min-w-0 break-words">{user.position}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
