/*
 * English content for My Profile and Set New Password.
 * Same pattern as the other content files — no hard-coded text in components.
 */

import type { ProfileContent, ResetPasswordContent } from './types'

export const profileEn: ProfileContent = {
  pageTitle: 'My Profile | Hawkim',
  adminPageTitle: 'My Profile · System Admin | Hawkim',
  title: 'My Profile',
  fields: { name: 'Name', email: 'Email', phone: 'Phone Number', position: 'Position', division: 'Division', department: 'Department', roles: 'Permission', password: 'Password' },
  none: '—',
  roles: { author: 'Author', reviewer: 'Reviewer', approver: 'Approver', admin: 'System Admin' },
  password: {
    change: 'Change',
    changeLabel: 'Change Password',
    changed: 'Password changed.',
    dialog: {
      title: 'Change Password',
      current: 'Current Password',
      next: 'New Password',
      confirm: 'Confirm New Password',
      hint: 'At least {min} characters.',
      show: 'Show password',
      hide: 'Hide password',
      cancel: 'Cancel',
      save: 'Save',
      saving: 'Saving…',
      close: 'Close',
      errors: {
        currentRequired: 'Enter your current password.',
        currentIncorrect: 'Incorrect password.',
        nextRequired: 'Enter a new password.',
        tooShort: 'Enter at least {min} characters.',
        confirmRequired: 'Enter your new password again.',
        mismatch: 'The passwords do not match.',
        sameAsCurrent: 'Choose a password different from your current one.',
        weak: 'This password is too weak. Choose a longer or stronger one.',
        tooManyAttempts: 'Too many attempts right now. Please wait a while and try again.',
        notConnected: 'We could not connect. Check your connection and try again.',
        sessionEnded: 'Your session has ended. Sign in again to change your password.',
        failed: 'Your password could not be saved. Please try again.',
      },
    },
  },
}

export const resetPasswordEn: ResetPasswordContent = {
  pageTitle: 'Set New Password | Hawkim',
  logoAlt: 'Hawkim',
  title: 'Set New Password',
  text: 'Enter your new password twice.',
  passwordLabel: 'New Password',
  passwordHint: 'At least {min} characters.',
  confirmLabel: 'Confirm New Password',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  save: 'Save Password',
  errors: {
    passwordRequired: 'Enter a new password.',
    passwordTooShort: 'Enter at least {min} characters.',
    confirmRequired: 'Enter your new password again.',
    mismatch: 'The passwords do not match.',
    weakPassword: 'This password is too weak. Choose a longer or stronger one.',
    samePassword: 'Choose a password different from your current one.',
    tooManyAttempts: 'Too many attempts right now. Please wait a while and try again.',
    notConnected: 'We could not connect. Check your connection and try again.',
    failed: 'Your password could not be saved. Please try again.',
  },
  invalid: {
    title: 'This Link Can\'t Be Used',
    text: 'The link is invalid or has expired. Request a new one from your profile.',
    action: { label: 'Go to My Profile' },
  },
  saved: {
    title: 'Password Changed',
    text: 'Your new password is saved.',
    dashboard: { label: 'Go to Dashboard', href: '/dashboard' },
    signIn: { label: 'Sign In', href: '/login' },
  },
}
