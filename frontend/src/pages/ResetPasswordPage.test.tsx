import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { resetPasswordEn } from '../content/profile.en'
import { newPasswordProblems } from '../lib/newPassword'
import { profilePathFor, RESET_PASSWORD_PATH } from '../lib/routes'
import { NewPasswordForm, ResetPasswordPage } from './ResetPasswordPage'

vi.mock('../services/auth', () => ({ restoreSession: vi.fn(), setNewPassword: vi.fn(), startPasswordRecovery: vi.fn() }))
vi.mock('../state/sessionContext', () => ({ useSession: () => ({ signIn: vi.fn() }) }))

describe('Set New Password', () => {
  it('waits for the recovery link before showing the form', () => {
    const html = renderToStaticMarkup(<MemoryRouter><ResetPasswordPage /></MemoryRouter>)
    expect(html).not.toContain('<form')
  })

  it('asks for the password twice, with labels, as new passwords', () => {
    const html = renderToStaticMarkup(<NewPasswordForm onSaved={() => {}} onExpired={() => {}} />)
    const inputs = html.match(/<input[^>]*>/g)!
    expect(inputs).toHaveLength(2)
    for (const input of inputs) {
      expect(input).toContain('type="password"')
      expect(input).toContain('autoComplete="new-password"')
      expect(html).toContain(`for="${input.match(/ id="([^"]+)"/)![1]}"`)
    }
    expect(html).toContain(`>${resetPasswordEn.passwordLabel}<`)
    expect(html).toContain(`>${resetPasswordEn.confirmLabel}<`)
    expect(html).toContain('At least 6 characters.')
  })

  it('checks that both passwords are there, long enough and match', () => {
    expect(newPasswordProblems('', '')).toEqual({ password: 'required', confirm: 'required' })
    expect(newPasswordProblems('short', 'short')).toEqual({ password: 'too-short' })
    expect(newPasswordProblems('long enough', 'different')).toEqual({ confirm: 'mismatch' })
    expect(newPasswordProblems('long enough', 'long enough')).toEqual({})
  })

  it('sends a new request to the person\'s own profile page', () => {
    expect(profilePathFor({ permissions: ['author'] })).toBe('/profile')
    expect(profilePathFor({ permissions: ['admin'] })).toBe('/admin/profile')
    expect(resetPasswordEn.invalid.action.label).toBe('Go to My Profile')
    expect(RESET_PASSWORD_PATH).toBe('/reset-password')
  })
})
