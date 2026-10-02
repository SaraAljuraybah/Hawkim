import { Link, NavLink } from 'react-router-dom'
import { X } from 'lucide-react'
import type { AppShellContent } from '../../content/types'
import { icons } from '../icons'
import { Logo } from '../ui/Logo'

interface SidebarProps {
  content: AppShellContent
  /** Called after any link is followed (used by the mobile drawer to close itself). */
  onNavigate?: () => void
  /** When given, a close button is shown next to the logo (mobile drawer). */
  onClose?: () => void
}

const itemBase =
  'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors'

/**
 * Sidebar contents: logo, main navigation and Sign Out.
 * Used as the fixed desktop sidebar and inside the mobile drawer.
 */
export function Sidebar({ content, onNavigate, onClose }: SidebarProps) {
  const SignOutIcon = icons[content.signOut.icon]
  const homeHref = content.nav[0].href

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-5">
        {/* Mark + product name; the link's accessible name comes from aria-label */}
        <Link
          to={homeHref}
          onClick={onNavigate}
          aria-label={content.homeLinkLabel}
          className="inline-flex items-center gap-2.5 rounded-md"
        >
          <Logo variant="mark" alt="" className="h-8" />
          <span className="text-[1.1875rem] font-semibold tracking-tight text-maroon">{content.brandName}</span>
        </Link>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={content.closeMenu}
            className="inline-flex size-10 items-center justify-center rounded-lg border border-beige text-maroon hover:bg-beige"
          >
            <X aria-hidden="true" className="size-5" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <nav aria-label={content.navAriaLabel} className="flex flex-1 flex-col px-3 pb-5">
        <ul className="space-y-1">
          {content.nav.map((item) => {
            const Icon = icons[item.icon]
            return (
              <li key={item.href}>
                {/* NavLink sets aria-current="page" on the active item */}
                <NavLink
                  to={item.href}
                  end
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `${itemBase} ${
                      isActive ? 'bg-maroon/[0.07] text-maroon' : 'text-text-gray hover:bg-beige hover:text-maroon'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-gold" />
                      )}
                      <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} />
                      {item.label}
                    </>
                  )}
                </NavLink>
              </li>
            )
          })}
        </ul>

        {/* Sign Out pinned to the bottom */}
        <div className="mt-auto border-t border-beige pt-4">
          {/* DEMO: there is no session yet, so signing out just returns to the Sign In page. */}
          <Link
            to={content.signOut.href}
            onClick={onNavigate}
            className={`${itemBase} text-text-gray hover:bg-beige hover:text-maroon`}
          >
            <SignOutIcon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} />
            {content.signOut.label}
          </Link>
        </div>
      </nav>
    </div>
  )
}
