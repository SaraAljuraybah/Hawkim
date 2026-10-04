/*
 * English content for the signed-in app (shell and dashboard).
 * Same pattern as landing.en.ts — components never contain hard-coded text.
 * Sample data (user, stats, activity) lives separately in src/data/mock/.
 */

import type { AppShellContent, DashboardContent } from './types'

export const appShellEn: AppShellContent = {
  skipLink: 'Skip to main content',
  brandName: 'Hawkim',
  homeLinkLabel: 'Hawkim, go to dashboard',
  navAriaLabel: 'Main',
  nav: [
    { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
    { label: 'SOPs', href: '/sops', icon: 'sops', matchSubpaths: true },
    // Author permission only
    { label: 'My SOPs', href: '/my-sops', icon: 'mySops', matchSubpaths: true, permission: 'author' },
    // Reviewer or Approver permission only
    {
      label: 'My Reviews',
      href: '/reviews',
      icon: 'reviews',
      matchSubpaths: true,
      permission: ['reviewer', 'approver'],
    },
    { label: 'My Requests', href: '/requests', icon: 'requests', matchSubpaths: true },
    { label: 'Departments', href: '/departments', icon: 'departments' },
  ],
  signOut: { label: 'Sign Out', href: '/login', icon: 'signOut' },
  notificationsLabel: 'Notifications',
  openMenu: 'Open menu',
  closeMenu: 'Close menu',
  drawerLabel: 'Navigation',
  reviewsToDoLabel: '{count} to do',
  departmentSwitcher: {
    label: 'Department',
    menuLabel: 'Your departments',
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
    // These screens are not built yet; the links show the Not Found page for now.
    primary: { label: 'Submit a Request', href: '/requests/new', icon: 'submitRequest' },
    secondary: [
      // Author permission only (placed right after "Submit a Request")
      { label: 'Upload SOP', href: '/my-sops/upload', icon: 'upload', permission: 'author' },
      // Reviewer or Approver permission only
      { label: 'My Reviews', href: '/reviews', icon: 'reviews', permission: ['reviewer', 'approver'] },
      { label: 'View SOPs', href: '/sops', icon: 'sops' },
      { label: 'View Departments', href: '/departments', icon: 'departments' },
    ],
  },
}
