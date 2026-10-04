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
    nav: [
      { label: 'Users', href: '/admin/users', icon: 'employees', matchSubpaths: true },
      { label: 'Departments', href: '/admin/departments', icon: 'departments', matchSubpaths: true },
    ],
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
        reviewer: '{name} is assigned as a reviewer on {sops}.',
        approver: '{name} is assigned as an approver on {sops}.',
      },
      cantRemove: "{permission} can't be removed: {reason}",
      sopWithStatus: '{code} ({status})',
    },
  },

  departmentsList: {
    title: 'Departments',
    subtitle: "Manage your organization's departments.",
    addDepartment: { label: 'Add department', href: '/admin/departments/new' },
    search: { label: 'Search', placeholder: 'Search by name' },
    count: { one: '{count} department', other: '{count} departments' },
    tableLabel: 'Departments',
    columns: { name: 'Name', description: 'Description', members: 'Members', withAccess: 'With access', sops: 'SOPs' },
    cardCounts: {
      members: { one: '{count} member', other: '{count} members' },
      withAccess: { one: '{count} with access', other: '{count} with access' },
      sops: { one: '{count} SOP', other: '{count} SOPs' },
    },
    empty: 'No departments match your search.',
  },

  departmentForm: {
    add: {
      title: 'Add department',
      subtitle: 'Add a department of your organization.',
      submit: 'Add department',
    },
    edit: {
      title: 'Edit department',
      subtitle: 'Change the name, initials or description of {name}.',
      submit: 'Save changes',
    },
    backToList: { label: 'Back to departments', href: '/admin/departments' },
    backToDepartment: 'Back to {name}',
    name: { label: 'Name' },
    initials: { label: 'Initials', hint: '2–3 letters, e.g. QA. Shown in the department badge.' },
    description: { label: 'Description (optional)', hint: 'One line about what the department does (up to 200 characters).' },
    cancel: 'Cancel',
    errors: {
      nameRequired: 'Enter a department name.',
      nameTooLong: 'Keep the name to 60 characters or fewer.',
      nameTaken: 'A department with this name already exists.',
      initialsInvalid: 'Enter 2–3 letters.',
      initialsTaken: 'These initials are already used.',
      descriptionTooLong: 'Keep the description to 200 characters or fewer.',
    },
  },

  departmentDetails: {
    back: { label: 'Back to departments', href: '/admin/departments' },
    added: 'Department added.',
    updated: 'Department updated.',
    titleWithCount: '{title} ({count})',
    details: { title: 'Details', initials: 'Initials', description: 'Description', noDescription: 'No description.' },
    members: { title: 'Members', empty: 'No members.' },
    withAccess: {
      title: 'With access',
      hint: 'Users from other departments who joined through approved access requests.',
      empty: 'Nobody from other departments has access.',
    },
    sops: { title: 'SOPs', label: 'SOPs by status' },
    edit: 'Edit',
    remove: {
      title: 'Remove department',
      text: 'Only an empty department can be removed: no members, SOPs, users with access or pending access requests.',
      button: 'Remove department',
      refused: "{name} can't be removed yet:",
      blockers: {
        members: { one: '{count} member', other: '{count} members' },
        sops: { one: '{count} SOP', other: '{count} SOPs' },
        withAccess: { one: '{count} user with access', other: '{count} users with access' },
        pendingRequests: { one: '{count} pending access request', other: '{count} pending access requests' },
      },
      dialog: {
        title: 'Remove {name}?',
        description: "This can't be undone.",
        confirm: 'Remove',
        cancel: 'Cancel',
      },
      done: '{name} removed.',
    },
  },
}
