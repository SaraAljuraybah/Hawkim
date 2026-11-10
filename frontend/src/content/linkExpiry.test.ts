import { describe, expect, it } from 'vitest'
// The auth email templates (the send-email hook, also used by add-user) and the sign-in texts, as text.
import templates from '../../../supabase/functions/send-email/templates.ts?raw'
import auth from './auth.en.ts?raw'

describe('email link expiry texts', () => {
  it('say 24 hours, matching the 86400-second email OTP expiry, and never 1 hour', () => {
    expect(templates).not.toMatch(/\b1 hour\b/)
    expect(templates.match(/expires in 24 hours/g)).toHaveLength(6)
    expect(auth).not.toMatch(/\b1 hour\b/)
    expect(auth).toContain('The link expires in 24 hours.')
  })
})
