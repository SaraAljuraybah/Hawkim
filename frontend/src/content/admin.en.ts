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

  usersList: {
    title: 'Users',
    subtitle: 'Manage who can use Hawkim and what they can do.',
    addUser: { label: 'Add user', href: '/admin/users/new' },
    search: { label: 'Search', placeholder: 'Search by name or email' },
    departmentFilter: { label: 'Department', all: 'All departments' },
    permissionFilter: { label: 'Permission', all: 'All permissions' },
    count: { one: '{count} user', other: '{count} users' },
    tableLabel: 'Users',
    columns: { name: 'Name', email: 'Email', department: 'Department', permissions: 'Permissions' },
    empty: 'No users match your search.',
  },
}
