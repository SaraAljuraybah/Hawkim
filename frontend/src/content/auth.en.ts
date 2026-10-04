/*
 * English content for the authentication pages (currently: Sign In).
 * Same pattern as landing.en.ts — components never contain hard-coded text,
 * so an Arabic version (auth.ar.ts) can be added later.
 */

import type { SignInContent } from './types'

export const signInEn: SignInContent = {
  pageTitle: 'Sign In | Hawkim',

  brand: {
    logoAlt: 'Hawkim',
    taglineLines: ['Compliance', 'for a Safer Tomorrow'],
    regulatoryNote: 'Designed for pharmaceutical organizations regulated by the SFDA',
  },

  title: 'Welcome Back',
  subtitle: 'Sign in to your Hawkim account',

  email: {
    label: 'Email',
    placeholder: 'you@organization.com',
  },
  password: {
    label: 'Password',
    placeholder: 'Enter your password',
    showLabel: 'Show password',
    hideLabel: 'Hide password',
  },

  // The forgot-password page will be built in a later feature branch
  // (until then this link shows the Not Found page).
  forgotPassword: { label: 'Forgot password?', href: '/forgot-password' },

  submit: {
    label: 'Sign In',
    loadingLabel: 'Signing in…',
  },

  errors: {
    emailRequired: 'Enter your email address.',
    emailInvalid: 'Enter a valid email address, like you@organization.com.',
    passwordRequired: 'Enter your password.',
  },

  results: {
    notConnected: "Sign-in isn't connected yet. This will work once the backend is ready.",
    noAccess: 'This account no longer has access to Hawkim.',
  },

  // TODO: The Terms of Use and Privacy Policy documents don't exist yet.
  // Until those pages are written and added, these links show the Not Found page.
  legal: {
    prefix: 'By signing in, you agree to our ',
    terms: { label: 'Terms of Use', href: '/terms' },
    conjunction: ' and ',
    privacy: { label: 'Privacy Policy', href: '/privacy' },
    suffix: '.',
  },
}
