/*
 * English content for the app-wide screens about the connection to the backend.
 */

import type { SystemContent } from './types'

export const systemEn: SystemContent = {
  logoAlt: 'Hawkim',
  notConfigured: {
    pageTitle: 'Not Configured | Hawkim',
    title: "Hawkim isn't configured",
    missing:
      'Create frontend/.env.local with the Supabase URL and publishable key (see frontend/.env.example), then restart the app.',
    urlFormat:
      'VITE_SUPABASE_URL in frontend/.env.local must be only the project address, like https://abcdefghijkl.supabase.co. Remove anything after .supabase.co (such as /rest/v1/ or a final /), then restart the app.',
    secretKey:
      'frontend/.env.local uses the secret key. Replace it with the publishable key, then restart the app.',
  },
  loadFailed: {
    pageTitle: "Couldn't Load | Hawkim",
    title: "Couldn't load Hawkim",
    text: 'Check your internet connection and try again.',
    retry: 'Try again',
  },
}
