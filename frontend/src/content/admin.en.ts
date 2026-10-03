/*
 * English content for the admin portal (/admin): its own sidebar and top bar, and its pages.
 * Same pattern as the other content files: components never contain hard-coded text.
 */

import type { AdminContent } from './types'

export const adminEn: AdminContent = {
  shell: {
    skipLink: 'Skip to main content',
    brandName: 'Hawkim',
    portalLabel: 'Admin',
    homeLinkLabel: 'Hawkim admin, go to users',
    navAriaLabel: 'Admin',
    nav: [{ label: 'Users', href: '/admin/users', icon: 'employees', matchSubpaths: true }],
    signOut: { label: 'Sign Out', href: '/login', icon: 'signOut' },
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    drawerLabel: 'Navigation',
    roleLabel: 'Administrator',
  },
  pageTitle: '{page} · Admin | Hawkim',
}
