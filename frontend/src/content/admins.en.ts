/*
 * English content for Manage Organization → Admins in the admin portal: the administrators list,
 * Add Admin, Edit Admin, an administrator's page, Delete Admin, Reactivate Admin and Make Super Admin.
 * Same pattern as the other content files: components never contain hard-coded text.
 */

import type { AdminActionFailure, AdminsContent } from './types'

const failures: Record<AdminActionFailure, string> = {
  forbidden: "You don't have permission to do this. Sign in again and retry.",
  'not-found': 'This Admin no longer exists. Refresh the page.',
  invalid: 'Check the details and try again.',
  'super-admin-required': 'Only the Super Admin can do this. The permission may have just changed: refresh the page.',
  'super-admin-protected': 'Only the Super Admin can change the Super Admin’s account, and it can’t be deleted.',
  'recipient-not-admin': 'This person is no longer an active Admin. Refresh the page.',
  'recipient-self': 'Choose another Admin.',
  failed: 'Check your connection and try again.',
}

export const adminsEn: AdminsContent = {
  pageTitle: '{page} · Admin Portal | Hawkim',
  roles: { superAdmin: 'Super Admin', admin: 'Admin' },
  superAdminTooltip:
    "The organization's main admin, first given to the person who requested Hawkim. Only they can edit the organization profile, delete admins and hand over this permission to another admin.",

  list: {
    title: 'Admins',
    description: "View and manage Hawkim's Admins.",
    add: { label: 'Add Admin', href: '/admin/admins/new' },
    search: { label: 'Search Admins', placeholder: 'Search by admin name or email' },
    // The Filter (Permission) and Sort, as on the Staff page.
    role: { legend: 'Admin permission', count: { one: '{count} permission', other: '{count} permissions' } },
    sort: { label: 'Sort', options: { default: 'Default order', 'name-asc': 'A to Z', 'name-desc': 'Z to A' }, groups: { name: 'Admin name' } },
    clearFilters: 'Clear Filters',
    tableLabel: 'Admins',
    tabs: { label: 'Admin status', active: 'Active Admins', deactivated: 'Deactivated Admins' },
    columns: { name: 'Full Name', email: 'Email', phone: 'Phone Number', role: 'Permission', preview: 'Preview', edit: 'Edit', delete: 'Delete', reactivate: 'Reactivate' },
    none: '—',
    actions: { view: 'View {name}', edit: 'Edit {name}' },
    empty: 'No Admins yet.',
    emptyDeactivated: 'No deactivated Admins found.',
    noMatches: 'No Admins match your search or filter.',
    loading: 'Loading Admins…',
    loadFailed: "The Admins couldn't be loaded.",
    retry: 'Try Again',
  },

  add: {
    title: 'Add Admin',
    subtitle: 'Add someone who should manage your organization in Hawkim. The Super Admin permission can only be transferred by the current Super Admin.',
    submit: 'Add Admin',
    adding: 'Adding…',
    notAdded: "Admin wasn't added:",
    failures: {
      forbidden: "You don't have permission to add Admins. Sign in again and retry.",
      'email-taken': 'Someone with this email already has a Hawkim account.',
      invalid: 'Check the details and try again.',
      'account-failed': "The account couldn't be created. Try again in a few minutes.",
      'account-blocked': "This person's account is blocked. Ask the project owner to unblock it.",
      'deactivated-admin': 'This admin was deleted. You can reactivate their account from the Deactivated Admins tab.',
      failed: 'Check your connection and try again.',
    },
  },

  form: {
    back: { label: 'Back to Admins', href: '/admin/admins' },
    name: { label: 'Full Name' },
    email: { label: 'Email' },
    phone: { label: 'Phone Number', hint: 'Saudi mobile number: +9665XXXXXXXX' },
    cancel: 'Cancel',
    errors: {
      nameRequired: "Enter the Admin's full name.",
      emailInvalid: 'Enter a valid email address, e.g. name@example.com.',
      emailTaken: 'Someone with this email already has a Hawkim account.',
      phoneRequired: 'Enter a phone number.',
      phoneInvalid: 'Enter the 8 digits after +9665.',
    },
  },

  edit: {
    title: 'Edit Admin',
    subtitle: "Change the Admin's details. Their permission stays the same.",
    submit: 'Save Changes',
    saving: 'Saving…',
    saved: 'Changes saved.',
    notSaved: "Changes weren't saved:",
    emailNotSaved: "The other changes were saved, but the email wasn't:",
    failures,
    emailFailures: {
      forbidden: "You don't have permission to change this email. Sign in again and retry.",
      'not-found': 'This Admin no longer exists. Refresh the page.',
      'email-taken': 'Someone with this email already has a Hawkim account.',
      invalid: 'Enter a valid email address, e.g. name@example.com.',
      'account-failed': "The sign-in email couldn't be changed. Try again in a few minutes.",
      failed: 'Check your connection and try again.',
    },
    readOnly: 'Only the Super Admin can edit the Super Admin’s account.',
    discard: {
      title: 'Discard unsaved changes?',
      description: "Your changes to this Admin haven't been saved. If you leave now, they'll be lost.",
      keep: 'Keep Editing',
      discard: 'Discard Changes',
    },
  },

  details: {
    back: { label: 'Back to Admins', href: '/admin/admins' },
    title: 'Details',
    name: 'Full Name',
    email: 'Email',
    phone: 'Phone Number',
    role: 'Permission',
    notSet: 'Not set',
    edit: 'Edit Admin',
    copyEmail: 'Copy {name}’s email',
    copied: 'Email copied',
    copyFailed: 'Could not copy email. Select and copy the address.',
    superAdminReadOnly: 'This is the Super Admin. Only they can change this account.',
    ownSuperAdmin: 'You are the Super Admin. To give up this permission, make another Admin the Super Admin from Edit Admin.',
    added: 'Admin added. They received an email to set their password.',
    addedInvitationFailed: "Admin added, but the invitation email couldn't be sent. Ask them to use “Forgot password?” on the sign-in page.",
  },

  delete: {
    button: 'Delete {name}',
    label: 'Delete Admin',
    title: 'Delete {name}?',
    description: "Are you sure you want to delete this admin? Their account will become inactive and they won't be able to sign in. Their past records will be kept. You can reactivate their account later from the Deactivated Admins tab.",
    cancel: 'Cancel',
    confirm: 'Delete',
    deleting: 'Deleting…',
    done: '{name} was deleted. Their account is now inactive.',
    notDeleted: "{name} wasn't deleted:",
  },

  // Reactivate Admin: the same layout and wording as Reactivate Staff.
  reactivate: {
    button: 'Reactivate {name}',
    label: 'Reactivate Admin',
    busy: 'Reactivating {name}…',
    title: 'Reactivate {name}?',
    description: 'Their account will be active again, with the Admin permission. They can sign in to Hawkim with their existing password.',
    cancel: 'Cancel',
    confirm: 'Reactivate',
    refused: "{name} wasn't reactivated:",
    done: '{name} was reactivated. Their account is active again.',
    failures: {
      forbidden: "You don't have permission to reactivate Admins. Sign in again and retry.",
      'not-found': 'This Admin no longer exists. Refresh the page.',
      'super-admin-required': 'Only the Super Admin can do this. The permission may have just changed: refresh the page.',
      'email-taken': "Another active account now uses this email, so they can't be reactivated.",
      'account-unavailable': "Their sign-in account is no longer available, so they can't be reactivated.",
      failed: 'Check your connection and try again.',
    },
  },

  transfer: {
    button: 'Make Super Admin',
    title: 'Transfer Super Admin Permission?',
    intro: 'Are you sure you want to make {name} the new Super Admin?',
    proceed: 'If you proceed:',
    consequences: [
      '{name} will become the new Super Admin.',
      'Your permission will change to a regular Admin.',
      'You will lose permission to delete Admins and transfer the Super Admin permission.',
      'You will retain your regular Admin permissions.',
    ],
    effect: 'This change will take effect immediately.',
    cancel: 'Cancel',
    confirm: 'Confirm Transfer',
    transferring: 'Transferring…',
    done: '{name} is now the Super Admin. You are now an Admin.',
    notTransferred: "The Super Admin permission wasn't transferred:",
  },

  failures,
}
