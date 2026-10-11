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
  'relative flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium transition-colors'
/* Not the active item: light text with a subtle light overlay on hover. */
const itemIdle = 'text-beige hover:bg-white/[0.06] hover:text-offwhite'
/* Icons in light gold (8.84:1 on maroon; 6.84:1 on the active tint). */
const itemIcon = 'size-5 shrink-0 text-gold-light'

/**
 * Sidebar contents: logo, main navigation and Sign Out, on Primary Maroon (as in the
 * landing page's dashboard preview). Used as the fixed desktop sidebar and inside the
 * mobile drawer, in the employee app and in the admin portal (with an "Admin" label).
 * Contrast on maroon #3A0B18: beige text 14.39:1, white active text 13.08:1 on the
 * active tint, light gold icons/badges/focus ring 8.84:1.
 */
export function Sidebar({ content, onNavigate, onClose, departmentSwitcher, badges }: SidebarProps) {
  const SignOutIcon = icons[content.signOut.icon]
  const { signOut } = useSession()
  const homeHref = content.nav[0].href

  return (
    // On maroon the default maroon focus ring would be invisible: use light gold (not
    // inside the white department menu that opens from the drawer).
    <div className="flex h-full flex-col bg-maroon [&_:focus-visible:not([role=menuitemradio])]:outline-gold-light">
      <div className="flex items-center justify-between gap-2 px-5 pt-6 pb-6">
        {/* Mark + product name; the link's accessible name comes from aria-label */}
        <Link
          to={homeHref}
          onClick={onNavigate}
          aria-label={content.homeLinkLabel}
          className="inline-flex items-center gap-2.5 rounded-md"
        >
          {/* The official on-dark mark (off-white rings, gold centre) for the maroon sidebar */}
          <Logo variant="markOnDark" alt="" className="h-10" />
          <span className="text-[1.375rem] font-semibold tracking-tight text-offwhite">{content.brandName}</span>
          {content.portalLabel && (
            <span className="rounded-md bg-gold-light px-1.5 py-0.5 text-xs font-semibold text-maroon">
              {content.portalLabel}
            </span>
          )}
        </Link>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={content.closeMenu}
            className="inline-flex size-10 items-center justify-center rounded-lg border border-white/20 text-offwhite hover:bg-white/[0.06]"
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
        <ul className="space-y-1.5">
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
                      isActive ? 'bg-white/10 text-white' : itemIdle
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-gold" />
                      )}
                      <Icon aria-hidden="true" className={itemIcon} strokeWidth={1.75} />
                      {item.label}
                      {badges?.[item.href] && (
                        <>
                          <span
                            aria-hidden="true"
                            className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-gold-light px-1.5 py-0.5 text-xs leading-none font-semibold text-maroon"
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
        <div className="mt-auto border-t border-white/10 pt-4">
          {/* Ends the session, then goes to the Sign In page. */}
          <Link
            to={content.signOut.href}
            onClick={() => {
              signOut()
              onNavigate?.()
            }}
            className={`${itemBase} ${itemIdle}`}
          >
            <SignOutIcon aria-hidden="true" className={itemIcon} strokeWidth={1.75} />
            {content.signOut.label}
          </Link>
        </div>
      </nav>
    </div>
  )
}
