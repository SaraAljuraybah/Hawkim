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

  permissionDescriptions: {
    author: 'Uploads SOPs, works on them with co-authors and submits them for review.',
    reviewer: 'Reviews submitted SOPs and returns them with comments when needed.',
    approver: 'Approves reviewed SOPs and publishes them.',
    admin: 'Manages users and permissions in the admin portal.',
  },

  addUser: {
    title: 'Add user',
    subtitle: 'Add someone who should be able to use Hawkim.',
    back: { label: 'Back to users', href: '/admin/users' },
    name: { label: 'Full name' },
    email: { label: 'Email', hint: 'They sign in with this email.' },
    department: { label: 'Department', placeholder: 'Select a department' },
    permissions: {
      legend: 'Permissions (optional)',
      hint: 'Every user is an employee. Permissions add features on top.',
    },
    submit: 'Add user',
    cancel: 'Cancel',
    errors: {
      nameRequired: "Enter the user's full name.",
      emailInvalid: 'Enter a valid email address.',
      emailTaken: 'A user with this email already exists.',
      departmentRequired: 'Select a department.',
    },
  },

  userDetails: {
    back: { label: 'Back to users', href: '/admin/users' },
    added: 'User added.',
    details: {
      title: 'Details',
      email: 'Email',
      homeDepartment: 'Home department',
      joinedDepartments: 'Joined departments',
      joinedHint: 'Through approved department access requests.',
      none: 'None',
    },
    permissions: {
      title: 'Permissions',
      legend: 'Permissions of {name}',
      save: 'Save permissions',
      saved: 'Permissions updated.',
      refused: "Permissions weren't saved:",
    },
    involvement: {
      title: 'Involved in',
      empty: 'Not involved in any SOP.',
      label: 'SOPs this user is involved in',
      roles: { author: 'Author', 'co-author': 'Co-author', reviewer: 'Reviewer', approver: 'Approver' },
      rolesLabel: 'Role:',
    },
    delete: {
      title: 'Delete user',
      text: 'They will no longer be able to access Hawkim. Their name stays on SOP history.',
      button: 'Delete user',
      refused: "{name} can't be deleted yet:",
      dialog: {
        title: 'Delete {name}?',
        description: "They will no longer be able to access Hawkim. This can't be undone.",
        confirm: 'Delete',
        cancel: 'Cancel',
      },
      done: '{name} deleted.',
    },
    blockers: {
      selfDelete: "You can't delete your own account.",
      selfAdmin: "You can't remove your own Admin permission.",
      lastAdmin: 'Hawkim must always have at least one admin, and {name} is the only one.',
      inUse: {
        author: '{name} authors or co-authors {sops} (not published yet).',
        reviewer: '{name} has a pending review on {sops}.',
        approver: '{name} has a pending approval or publishing on {sops}.',
      },
      cantRemove: "{permission} can't be removed: {reason}",
    },
  },
}
