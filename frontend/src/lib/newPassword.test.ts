import { describe, expect, it } from 'vitest'
import { changePasswordProblems, PASSWORD_CHANGE_ACTIVE } from './newPassword'

describe('changePasswordProblems', () => {
  it('requires all three fields', () => {
    expect(changePasswordProblems('', '', '')).toEqual({ current: 'required', password: 'required', confirm: 'required' })
  })

  it('needs at least 6 characters and a matching confirmation', () => {
    expect(changePasswordProblems('old-one', '12345', '12345')).toEqual({ password: 'too-short' })
    expect(changePasswordProblems('old-one', '123456', '123457')).toEqual({ confirm: 'mismatch' })
  })

  it('refuses a new password equal to the current one', () => {
    expect(changePasswordProblems('same-pass', 'same-pass', 'same-pass')).toEqual({ sameAsCurrent: true })
  })

  it('accepts a different, long enough, confirmed password', () => {
    expect(changePasswordProblems('old-one', 'new-pass', 'new-pass')).toEqual({})
  })
})

it('keeps changing passwords switched off until it is connected', () => {
  expect(PASSWORD_CHANGE_ACTIVE).toBe(false)
})
