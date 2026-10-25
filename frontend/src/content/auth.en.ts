/*
 * English content for the authentication pages (Sign In and Forgot password).
 * Same pattern as landing.en.ts — components never contain hard-coded text,
 * so an Arabic version (auth.ar.ts) can be added later.
 */

import type { ForgotPasswordContent, SignInContent } from './types'

export const signInEn: SignInContent = {
  pageTitle: 'Sign In | Hawkim',

  brand: {
    logoAlt: 'Hawkim',
  },

  title: 'Welcome Back',

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

  // Leads to a short page: passwords are reset by the project owner for now.
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
    invalidCredentials: 'The email or password is incorrect.',
    tooManyAttempts: 'Too many sign-in attempts. Wait a few minutes, then try again.',
    notConnected: "Couldn't reach Hawkim. Check your internet connection and try again.",
    noAccess: "This account doesn't have access to Hawkim. Contact the project owner.",
    failed: "Sign-in didn't work. Please try again.",
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

export const forgotPasswordEn: ForgotPasswordContent = {
  pageTitle: 'Forgot Password | Hawkim',
  logoAlt: 'Hawkim',
  title: 'Forgot your password?',
  text: 'Ask the project owner to reset your password.',
  backLink: { label: 'Back to sign in', href: '/login' },
}
