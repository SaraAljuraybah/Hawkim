import { describe, expect, it } from 'vitest'
import { isSecretKey } from './supabase'

/** A JWT-shaped legacy key with this payload (the signature isn't checked). */
function legacyKey(payload: object): string {
  const part = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `eyJhbGciOiJIUzI1NiJ9.${part}.signature`
}

describe('the browser key check', () => {
  it('refuses the secret key and the legacy service_role key', () => {
    expect(isSecretKey('sb_secret_abc123')).toBe(true)
    expect(isSecretKey(legacyKey({ role: 'service_role' }))).toBe(true)
  })

  it('accepts the publishable key and the legacy anon key', () => {
    expect(isSecretKey('sb_publishable_abc123')).toBe(false)
    expect(isSecretKey(legacyKey({ role: 'anon' }))).toBe(false)
    expect(isSecretKey('not.a-valid-jwt.at-all')).toBe(false)
  })
})
