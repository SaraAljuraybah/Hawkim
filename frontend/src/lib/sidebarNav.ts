import type { AppNavGroup, AppNavItem, SidebarNavEntry } from '../content/types'

/** Whether a sidebar entry is a group of links (e.g. Manage Organization) rather than a link. */
export function isNavGroup(entry: SidebarNavEntry): entry is AppNavGroup {
  return 'children' in entry
}

/** Every link in the sidebar, those inside groups included, in order. */
export function navLinks(nav: SidebarNavEntry[]): AppNavItem[] {
  return nav.flatMap((entry) => (isNavGroup(entry) ? entry.children : [entry]))
}
