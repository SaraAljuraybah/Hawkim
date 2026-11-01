/*
 * English content for My Profile and Set New Password.
 * Same pattern as the other content files — no hard-coded text in components.
 */

import type { ProfileContent, ResetPasswordContent } from './types'

export const profileEn: ProfileContent = {
  pageTitle: 'My Profile | Hawkim',
  title: 'My Profile',
  fields: { name: 'Name', email: 'Email', department: 'Department', division: 'Division', roles: 'Role' },
  none: '—',
  roles: { author: 'Author', reviewer: 'Reviewer', approver: 'Approver' },
  password: {
    title: 'Password',
    text: 'We will email you a link to set a new password.',
    change: 'Change Password',
    sent: 'Check your email for a link to change your password.',
    errors: {
      tooManyAttempts: 'Too many requests right now. Please wait a while and try again.',
      notConnected: 'We could not connect. Check your connection and try again.',
      failed: 'The email could not be sent. Please try again.',
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
    action: { label: 'Go to My Profile', href: '/profile' },
  },
  saved: {
    title: 'Password Changed',
    text: 'Your new password is saved.',
    dashboard: { label: 'Go to Dashboard', href: '/dashboard' },
    signIn: { label: 'Sign In', href: '/login' },
  },
}
