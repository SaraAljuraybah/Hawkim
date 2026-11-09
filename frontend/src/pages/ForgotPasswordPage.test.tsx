import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { forgotPasswordEn } from '../content/auth.en'
import { forgotEmailProblem } from '../lib/forgotPassword'
import { ForgotPasswordPage } from './ForgotPasswordPage'

vi.mock('../services/auth', () => ({ sendPasswordResetEmail: vi.fn() }))

describe('Forgot password', () => {
  it('asks for the email address with a labelled email field, a send button and a way back', () => {
    const html = renderToStaticMarkup(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)
    const inputs = html.match(/<input[^>]*>/g)!
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toContain('type="email"')
    expect(inputs[0]).toContain('autoComplete="email"')
    expect(html).toContain(`for="${inputs[0].match(/ id="([^"]+)"/)![1]}"`)
    expect(html).toContain(`>${forgotPasswordEn.emailLabel}<`)
    expect(html).toContain(forgotPasswordEn.submit)
    expect(html).toContain(`href="${forgotPasswordEn.backLink.href}"`)
    expect(html).not.toContain('Ask the project owner')
  })

  it('checks that an email address was entered and looks valid', () => {
    expect(forgotEmailProblem('   ')).toBe(forgotPasswordEn.errors.emailRequired)
    expect(forgotEmailProblem('sara')).toBe(forgotPasswordEn.errors.emailInvalid)
    expect(forgotEmailProblem(' sara@hawkim.test ')).toBeUndefined()
  })

  it('confirms the same way whether or not the address has an account', () => {
    expect(forgotPasswordEn.sent.text).toContain('{email}')
    expect(forgotPasswordEn.sent.text).toMatch(/^If /)
  })
})
