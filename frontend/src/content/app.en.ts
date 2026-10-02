/*
 * English content for the signed-in app (shell and dashboard).
 * Same pattern as landing.en.ts — components never contain hard-coded text.
 * Sample data (user, stats, activity) lives separately in src/data/mock/.
 */

import type { AppShellContent } from './types'

export const appShellEn: AppShellContent = {
  skipLink: 'Skip to main content',
  logoAlt: 'Hawkim',
  navAriaLabel: 'Main',
  nav: [
    { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
    { label: 'My Requests', href: '/requests', icon: 'requests' },
    { label: 'SOPs', href: '/sops', icon: 'sops' },
    { label: 'Departments', href: '/departments', icon: 'departments' },
  ],
  signOut: { label: 'Sign Out', href: '/login', icon: 'signOut' },
  notificationsLabel: 'Notifications',
  openMenu: 'Open menu',
  closeMenu: 'Close menu',
  drawerLabel: 'Navigation',
}
