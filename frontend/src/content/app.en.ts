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
    { label: 'My Requests', href: '/requests', icon: 'requests', matchSubpaths: true },
    { label: 'SOP Directory', href: '/sops', icon: 'sops', matchSubpaths: true },
    { label: 'Organizational Structure', href: '/organizational-structure', icon: 'hierarchy' },
  ],

  signOut: { label: 'Sign Out', href: '/login', icon: 'signOut' },
  openMenu: 'Open menu',
  closeMenu: 'Close menu',
  rolesLabel: 'Your roles',
  drawerLabel: 'Navigation',
  reviewsToDoLabel: '{count} to do',
  profileLink: { label: 'My Profile, {name}', href: '/profile' },
  positionSeparator: '|',
  departmentSwitcher: {
    label: 'SOP Directory',
    menuLabel: 'Available SOP directories',
    readOnly: 'Read-only',
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
    sops: { label: 'SOPs', sublabel: 'In This Department', icon: 'sops' },
    employees: { label: 'Employees', sublabel: 'In This Department', icon: 'employees' },
  },
  recentActivity: {
    title: 'Recent Activity',
    empty: 'No activity yet. The SOPs you add, your reviews and your requests will show here.',
    justNow: 'Just now',
    messages: {
      sopAdded: 'You added the SOP “{title}”',
      versionUploaded: 'You added version {version} of “{title}”',
      submitted: 'You submitted “{title}” for review',
      resubmitted: 'You resubmitted “{title}”',
      reviewCompleted: 'You completed the review of “{title}”',
      reviewAccepted: 'You accepted the review of “{title}”',
      reviewDeclined: 'You declined the review of “{title}”',
      returned: 'You returned “{title}” to its author',
      approved: 'You approved “{title}”',
      coAuthorAdded: 'You added a co-author to “{title}”',
      requestSent: 'You sent the request “{title}”',
      requestApproved: 'Your request “{title}” was approved',
      requestRejected: 'Your request “{title}” was rejected',
    },
  },
  quickActions: {
    title: 'Quick Actions',
    primary: { label: 'Submit a Request', href: '/requests/new', icon: 'submitRequest' },
    secondary: [
      // Author permission only (placed right after "Submit a Request")
      { label: 'Add SOP', href: '/my-sops/upload', icon: 'upload', permission: 'author' },
      // Reviewer or Approver permission only
      { label: 'My Reviews', href: '/reviews', icon: 'reviews', permission: ['reviewer', 'approver'] },
    ],
  },
}
