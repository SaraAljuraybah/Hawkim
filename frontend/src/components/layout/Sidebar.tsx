import { Link, NavLink } from 'react-router-dom'
import { X } from 'lucide-react'
import type { AppShellContent, SidebarContent } from '../../content/types'
import { useSession } from '../../state/sessionContext'
import { icons } from '../icons'
import { Logo } from '../ui/Logo'
import { DepartmentSwitcher } from './DepartmentSwitcher'

interface SidebarProps {
  content: SidebarContent
  /** Called after any link is followed (used by the mobile drawer to close itself). */
  onNavigate?: () => void
  /** When given, a close button is shown next to the logo (mobile drawer). */
  onClose?: () => void
  /**
   * Show the department switcher under the logo (employee mobile drawer; the top bar
   * has it on larger screens).
   */
  departmentSwitcher?: AppShellContent['departmentSwitcher']
  /**
   * A count after a nav item, by its href (e.g. pending requests in the admin portal):
   * `text` is shown, `label` is what screen readers hear instead.
   */
  badges?: Record<string, { text: string; label: string }>
}

const itemBase =
  'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors'

/**
 * Sidebar contents: logo, main navigation and Sign Out.
 * Used as the fixed desktop sidebar and inside the mobile drawer, in the employee
 * app and in the admin portal (with an "Admin" label after the product name).
 */
export function Sidebar({ content, onNavigate, onClose, departmentSwitcher, badges }: SidebarProps) {
  const SignOutIcon = icons[content.signOut.icon]
  const { signOut } = useSession()
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
          {content.portalLabel && (
            <span className="rounded-md bg-maroon px-1.5 py-0.5 text-xs font-semibold text-offwhite">
              {content.portalLabel}
            </span>
          )}
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

      {departmentSwitcher && (
        <div className="px-3 pb-4">
          <DepartmentSwitcher content={departmentSwitcher} variant="drawer" onSwitched={onNavigate} />
        </div>
      )}

      <nav aria-label={content.navAriaLabel} className="flex flex-1 flex-col px-3 pb-5">
        <ul className="space-y-1">
          {content.nav.map((item) => {
            const Icon = icons[item.icon]
            return (
              <li key={item.href}>
                {/* NavLink sets aria-current="page" on the active item */}
                <NavLink
                  to={item.href}
                  end={!item.matchSubpaths}
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
                      {badges?.[item.href] && (
                        <>
                          <span
                            aria-hidden="true"
                            className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-maroon px-1.5 py-0.5 text-xs leading-none font-semibold text-offwhite"
                          >
                            {badges[item.href].text}
                          </span>
                          <span className="sr-only">, {badges[item.href].label}</span>
                        </>
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            )
          })}
        </ul>

        {/* Sign Out pinned to the bottom */}
        <div className="mt-auto border-t border-beige pt-4">
          {/* Ends the session, then goes to the Sign In page. */}
          <Link
            to={content.signOut.href}
            onClick={() => {
              signOut()
              onNavigate?.()
            }}
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
