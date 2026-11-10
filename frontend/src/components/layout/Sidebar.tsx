import { useId, useState } from 'react'
import { Link, NavLink, matchPath, useLocation } from 'react-router-dom'
import { ChevronDown, X } from 'lucide-react'
import type { AppNavGroup, AppNavItem, AppShellContent, SidebarContent } from '../../content/types'
import { isNavGroup } from '../../lib/sidebarNav'
import { useSession } from '../../state/sessionContext'
import { useAdminRoleLabel } from '../../state/superAdminContext'
import { PermissionBadges } from '../admin/UserBits'
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
  badges?: Badges
}

const itemBase =
  'relative flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium transition-colors'
/* Not the active item: light text with a subtle light overlay on hover. */
const itemIdle = 'text-beige hover:bg-white/[0.06] hover:text-offwhite'
/* Icons in light gold (8.84:1 on maroon; 6.84:1 on the active tint). */
const itemIcon = 'size-5 shrink-0 text-gold-light'

type Badges = Record<string, { text: string; label: string }>

/** Whether the link is the current page, as NavLink decides it. */
function isCurrent(item: AppNavItem, pathname: string): boolean {
  return matchPath({ path: item.href, end: !item.matchSubpaths }, pathname) !== null
}

/** The gold bar on the left of the current item. */
function ActiveBar() {
  return <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-gold" />
}

/**
 * A link of the sidebar. NavLink sets aria-current="page" on the current one. Links inside a group
 * have no icon and less padding; they are indented under the group's label.
 */
function SidebarLink({ item, badges, onNavigate, nested = false }: { item: AppNavItem; badges?: Badges; onNavigate?: () => void; nested?: boolean }) {
  const Icon = icons[item.icon]
  const badge = badges?.[item.href]
  return (
    <NavLink
      to={item.href}
      end={!item.matchSubpaths}
      onClick={onNavigate}
      className={({ isActive }) => `${itemBase} ${nested ? 'py-2.5' : ''} ${isActive ? 'bg-white/10 text-white' : itemIdle}`}
    >
      {({ isActive }) => (
        <>
          {isActive && <ActiveBar />}
          {!nested && <Icon aria-hidden="true" className={itemIcon} strokeWidth={1.75} />}
          {item.label}
          {badge && (
            <>
              <span
                aria-hidden="true"
                className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-gold-light px-1.5 py-0.5 text-xs leading-none font-semibold text-maroon"
              >
                {badge.text}
              </span>
              <span className="sr-only">, {badge.label}</span>
            </>
          )}
        </>
      )}
    </NavLink>
  )
}

/**
 * A collapsible group (e.g. Manage Organization): a button that shows or hides its links, with a
 * chevron that turns when open. It isn't a page. It opens by itself whenever one of its pages is
 * opened, also after a refresh or from a typed address. Closed while one of its pages is open, its
 * header is highlighted instead, so the current place is never hidden.
 */
function SidebarGroup({ group, badges, onNavigate }: { group: AppNavGroup; badges?: Badges; onNavigate?: () => void }) {
  const Icon = icons[group.icon]
  const listId = useId()
  const { pathname } = useLocation()
  const containsCurrent = group.children.some((item) => isCurrent(item, pathname))
  const [open, setOpen] = useState(containsCurrent)
  // Open again on arriving at one of its pages (adjusting state while rendering, as React recommends).
  const [wasCurrent, setWasCurrent] = useState(containsCurrent)
  if (containsCurrent !== wasCurrent) {
    setWasCurrent(containsCurrent)
    if (containsCurrent) setOpen(true)
  }
  const highlighted = containsCurrent && !open

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className={`${itemBase} w-full text-left ${highlighted ? 'bg-white/10 text-white' : itemIdle}`}
      >
        {highlighted && <ActiveBar />}
        <Icon aria-hidden="true" className={itemIcon} strokeWidth={1.75} />
        <span className="flex-1">{group.label}</span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-gold-light transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>
      {/* Indented so the links line up with the group's label */}
      <ul id={listId} hidden={!open} className="mt-1.5 ml-[1.375rem] space-y-1.5 border-l border-white/10 pl-2">
        {group.children.map((item) => (
          <li key={item.href}>
            <SidebarLink item={item} badges={badges} onNavigate={onNavigate} nested />
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * Sidebar contents: logo, main navigation and Sign Out, on Primary Maroon (as in the
 * landing page's dashboard preview). Used as the fixed desktop sidebar and inside the
 * mobile drawer, in the employee app and in the admin portal. Beside the product name, only an
 * administrator's role in the admin portal ("Super Admin" or "Admin"); staff permissions (Author,
 * Reviewer, Approver) are never shown there (they are on My Profile and the staff member's page).
 * Contrast on maroon #3A0B18: beige text 14.39:1, white active text 13.08:1 on the
 * active tint, light gold icons/badges/focus ring 8.84:1.
 */
export function Sidebar({ content, onNavigate, onClose, departmentSwitcher, badges }: SidebarProps) {
  const SignOutIcon = icons[content.signOut.icon]
  const { user, signOut } = useSession()
  // "Super Admin" or "Admin" in the admin portal (who the Super Admin is now); the permission label elsewhere.
  const adminLabel = useAdminRoleLabel(user)
  const homeHref = content.homeHref

  return (
    // On maroon the default maroon focus ring would be invisible: use light gold (not
    // inside the white department menu that opens from the drawer).
    <div className="flex h-full flex-col bg-maroon [&_:focus-visible:not([role=menuitemradio])]:outline-gold-light">
      <div className="flex items-start justify-between gap-2 px-5 pt-6 pb-6">
        {/* Mark + product name, then the administrator's role in the admin portal (nothing for staff) on the same line. The
            badges stay outside the link, whose aria-label would hide them from screen readers. Inline
            flow indented by the mark's width (2.5rem tall: about 2.36rem wide, plus the 0.5rem gap), with
            the link pulled back over it, so only badges that don't fit wrap, lined up under the name.
            Sized so "Hawkim" and one "Super Admin" badge fit on one line in the 16rem sidebar. */}
        <div className="min-w-0 flex-1 pl-[2.875rem] leading-7">
          <Link
            to={homeHref}
            onClick={onNavigate}
            aria-label={content.homeLinkLabel}
            className="mr-1.5 -ml-[2.875rem] inline-flex items-center gap-2 rounded-md align-middle"
          >
            {/* The official on-dark mark (off-white rings, gold centre) for the maroon sidebar */}
            <Logo variant="markOnDark" alt="" className="h-10" />
            <span className="text-lg font-semibold tracking-normal text-offwhite">{content.brandName}</span>
          </Link>
          {/* adminLabel is undefined for staff and outside the admin portal: no Author/Reviewer/Approver badges here */}
          {user && adminLabel !== undefined && <PermissionBadges user={user} sidebar label={content.rolesLabel} adminLabel={adminLabel} />}
        </div>
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
          {content.nav.map((entry) =>
            isNavGroup(entry) ? (
              <li key={entry.id}>
                <SidebarGroup group={entry} badges={badges} onNavigate={onNavigate} />
              </li>
            ) : (
              <li key={entry.href}>
                <SidebarLink item={entry} badges={badges} onNavigate={onNavigate} />
              </li>
            ),
          )}
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
