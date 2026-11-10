/*
 * English content for Manage Organization → Admins in the admin portal: the administrators list,
 * Add Admin, Edit Admin, an administrator's page, Delete Admin and Make Super Admin.
 * Same pattern as the other content files: components never contain hard-coded text.
 */

import type { AdminActionFailure, AdminsContent } from './types'

const failures: Record<AdminActionFailure, string> = {
  forbidden: "You don't have permission to do this. Sign in again and retry.",
  'not-found': 'This administrator no longer exists. Refresh the page.',
  invalid: 'Check the details and try again.',
  'super-admin-required': 'Only the Super Admin can do this. The role may have just changed: refresh the page.',
  'super-admin-protected': 'Only the Super Admin can change the Super Admin’s account, and it can’t be deleted.',
  'recipient-not-admin': 'This person is no longer an active Admin. Refresh the page.',
  'recipient-self': 'Choose another Admin.',
  failed: 'Check your connection and try again.',
}

export const adminsEn: AdminsContent = {
  pageTitle: '{page} · Admin | Hawkim',
  roles: { superAdmin: 'Super Admin', admin: 'Admin' },

  list: {
    title: 'Admins',
    description: 'Administrators manage staff, divisions, departments and the rest of your organization in Hawkim.',
    add: { label: 'Add Admin', href: '/admin/admins/new' },
    search: { label: 'Search Admins', placeholder: 'Search by name or email' },
    count: { one: '{count} administrator', other: '{count} administrators' },
    tableLabel: 'Admins',
    columns: { name: 'Name', email: 'Email', phone: 'Phone Number', role: 'Role', actions: 'Actions' },
    none: '—',
    actions: { view: 'View {name}', edit: 'Edit {name}' },
    empty: 'No administrators yet.',
    noMatches: 'No administrators match your search.',
    loading: 'Loading administrators…',
    loadFailed: "The administrators couldn't be loaded.",
    retry: 'Try Again',
  },

  add: {
    title: 'Add Admin',
    subtitle: 'Add someone who should manage your organization in Hawkim. They get an email to set their password.',
    roleNote: 'New administrators are added as Admin. Only the Super Admin can hand over the Super Admin role, from an Admin’s page.',
    submit: 'Add Admin',
    adding: 'Adding…',
    notAdded: "Admin wasn't added:",
    failures: {
      forbidden: "You don't have permission to add administrators. Sign in again and retry.",
      'email-taken': 'Someone with this email already has a Hawkim account.',
      invalid: 'Check the details and try again.',
      'account-failed': "The account couldn't be created. Try again in a few minutes.",
      'account-blocked': "This person's account is blocked. Ask the project owner to unblock it.",
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
      nameRequired: "Enter the administrator's full name.",
      emailInvalid: 'Enter a valid email address, e.g. name@example.com.',
      emailTaken: 'Someone with this email already has a Hawkim account.',
      phoneRequired: 'Enter a phone number.',
      phoneInvalid: 'Enter the 8 digits after +9665.',
    },
  },

  edit: {
    title: 'Edit Admin',
    subtitle: "Change the administrator's details. Their role stays the same.",
    submit: 'Save Changes',
    saving: 'Saving…',
    saved: 'Changes saved.',
    notSaved: "Changes weren't saved:",
    emailNotSaved: "The other changes were saved, but the email wasn't:",
    failures,
    emailFailures: {
      forbidden: "You don't have permission to change this email. Sign in again and retry.",
      'not-found': 'This administrator no longer exists. Refresh the page.',
      'email-taken': 'Someone with this email already has a Hawkim account.',
      invalid: 'Enter a valid email address, e.g. name@example.com.',
      'account-failed': "The sign-in email couldn't be changed. Try again in a few minutes.",
      failed: 'Check your connection and try again.',
    },
    readOnly: 'Only the Super Admin can edit the Super Admin’s account.',
    discard: {
      title: 'Discard unsaved changes?',
      description: "Your changes to this administrator haven't been saved. If you leave now, they'll be lost.",
      keep: 'Keep Editing',
      discard: 'Discard Changes',
    },
  },

  details: {
    back: { label: 'Back to Admins', href: '/admin/admins' },
    title: 'Administrator Details',
    name: 'Full Name',
    email: 'Email',
    phone: 'Phone Number',
    role: 'Role',
    notSet: 'Not set',
    edit: 'Edit Admin',
    you: 'This is you.',
    superAdminReadOnly: 'This is the Super Admin. Only they can change this account.',
    ownSuperAdmin: 'You are the Super Admin. To leave this role, make another Admin the Super Admin from their page.',
    added: 'Admin added. They received an email to set their password.',
    addedInvitationFailed: "Admin added, but the invitation email couldn't be sent. Ask them to use “Forgot password?” on the sign-in page.",
  },

  delete: {
    button: 'Delete {name}',
    title: 'Delete Admin?',
    description: "Are you sure you want to delete {name} ({email})? They will no longer be able to sign in to Hawkim. Their name stays on past records. This can't be undone.",
    cancel: 'Cancel',
    confirm: 'Delete',
    deleting: 'Deleting…',
    done: '{name} deleted.',
    notDeleted: "Admin wasn't deleted:",
  },

  transfer: {
    button: 'Make Super Admin',
    title: 'Transfer Super Admin Role?',
    intro: 'Are you sure you want to make {name} the new Super Admin?',
    proceed: 'If you proceed:',
    consequences: [
      '{name} will become the new Super Admin.',
      'Your role will change to a regular Admin.',
      'You will lose permission to delete administrators and transfer the Super Admin role.',
      'You will retain your regular administrator permissions.',
    ],
    effect: 'This change will take effect immediately.',
    cancel: 'Cancel',
    confirm: 'Confirm Transfer',
    transferring: 'Transferring…',
    done: '{name} is now the Super Admin. You are now an Admin.',
    notTransferred: "The Super Admin role wasn't transferred:",
  },

  failures,
}
