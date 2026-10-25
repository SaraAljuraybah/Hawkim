/*
 * English content for the signed-in app (shell and dashboard).
 * Same pattern as landing.en.ts — components never contain hard-coded text.
 * Sample data (user, stats, activity) lives separately in src/data/mock/.
 */

import type { AppShellContent, DashboardContent } from './types'

export const appShellEn: AppShellContent = {
  skipLink: 'Skip to main content',
  brandName: 'Hawkim',
  homeHref: '/dashboard',
  homeLinkLabel: 'Hawkim, go to dashboard',
  homeLinkLabelReadOnly: 'Hawkim, go to SOP Directory',
  navAriaLabel: 'Main',

  nav: [
    { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
    { label: 'My SOPs', href: '/my-sops', icon: 'mySops', matchSubpaths: true, permission: 'author' },
    { label: 'My Reviews', href: '/reviews', icon: 'reviews', matchSubpaths: true, permission: ['reviewer', 'approver'] },
    { label: 'My Request', href: '/requests', icon: 'requests', matchSubpaths: true },
    { label: 'SOP Directory', href: '/sops', icon: 'sops', matchSubpaths: true },
    { label: 'Organization Structure', href: '/departments', icon: 'departments' },
  ],

  signOut: { label: 'Sign Out', href: '/login', icon: 'signOut' },
  openMenu: 'Open menu',
  closeMenu: 'Close menu',
  drawerLabel: 'Navigation',
  reviewsToDoLabel: '{count} to do',
  departmentSwitcher: {
    label: 'SOP Directory',
    menuLabel: 'Available SOP directories',
    readOnly: 'read-only',
  },
}

export const dashboardEn: DashboardContent = {
  pageTitle: 'Dashboard | Hawkim',
  greetings: {
    morning: 'Good morning, {name}',
    afternoon: 'Good afternoon, {name}',
    evening: 'Good evening, {name}',
  },
  subtitle: "Here's what's happening in {department} today.",
  stats: {
    myRequests: { label: 'My Requests', sublabel: 'In Progress', icon: 'requests' },
    sops: { label: 'SOPs', sublabel: 'In this department', icon: 'sops' },
    employees: { label: 'Employees', sublabel: 'In this department', icon: 'employees' },
  },
  recentActivity: { title: 'Recent Activity' },
  quickActions: {
    title: 'Quick Actions',
    primary: { label: 'Submit a Request', href: '/requests/new', icon: 'submitRequest' },
    secondary: [
      // Author permission only (placed right after "Submit a Request")
      { label: 'Upload SOP', href: '/my-sops/upload', icon: 'upload', permission: 'author' },
      // Reviewer or Approver permission only
      { label: 'My Reviews', href: '/reviews', icon: 'reviews', permission: ['reviewer', 'approver'] },
    ],
  },
}
