import { describe, expect, it } from 'vitest'
import { checksOnBlur, isCompletePhone, PHONE_PREFIX, phoneDigitsOf, phoneFieldError, phoneInput, phoneValue } from './phone'
import { hasUnsavedChanges, normalizePhone, type NewUser } from './userAdmin'

describe('phone numbers: the fixed +9665 and 8 digits', () => {
  it('shows a stored number as its 8 digits', () => {
    expect(PHONE_PREFIX).toBe('+9665')
    expect(phoneDigitsOf('+966543921437')).toBe('43921437')
    for (const other of [undefined, '', '0543921437', '+966443921437', '+96654392143']) expect(phoneDigitsOf(other)).toBe('')
  })

  it('keeps "+9665" and the digits typed, or nothing, and saves an untouched number as it was', () => {
    expect(phoneValue('43921437')).toBe('+966543921437')
    expect(phoneValue('439')).toBe('+9665439')
    expect(phoneValue('')).toBe('')
    expect(normalizePhone(phoneValue(phoneDigitsOf('+966543921437')))).toBe('+966543921437')
    // 7 or 9 digits don't make a valid number.
    expect(normalizePhone(phoneValue('4392143'))).toBeNull()
    expect(normalizePhone(phoneValue('439214370'))).toBeNull()
  })

  it('needs exactly 8 digits, numbers only', () => {
    expect(isCompletePhone('43921437')).toBe(true)
    for (const other of ['', '4392143', '439214370', '4392143a']) expect(isCompletePhone(other), other).toBe(false)
  })

  it('cuts a pasted or autofilled whole number down to its 8 digits', () => {
    for (const pasted of ['0543921437', '543921437', '+966543921437', '966543921437', '+966 54 392 1437', '054-392-1437']) {
      expect(phoneInput(pasted, true), pasted).toBe('43921437')
    }
    // 8 digits, or something else, stay as they are (digits only).
    expect(phoneInput('43921437', true)).toBe('43921437')
    expect(phoneInput('12 34', true)).toBe('1234')
  })

  it('never rewrites typing, only drops what isn’t a digit', () => {
    expect(phoneInput('543921437', false)).toBe('543921437')
    expect(phoneInput('4392a1', false)).toBe('43921')
    expect(phoneInput('', false)).toBe('')
  })

  it('starts checking when left with a wrong number of digits, but not when empty (Save asks for it)', () => {
    expect(checksOnBlur('4392')).toBe(true)
    expect(checksOnBlur('439214370')).toBe(true)
    expect(checksOnBlur('')).toBe(false)
    expect(checksOnBlur('43921437')).toBe(false)
  })

  it('shows the error at once while checking, and clears it as soon as there are exactly 8 digits', () => {
    const message = 'Enter the 8 digits after +9665.'
    // Typing before leaving the field: no error yet.
    expect(phoneFieldError('4392', false, undefined, message)).toBeUndefined()
    // Left with 4 digits: the error at once; still while typing a 5th; gone at 8.
    expect(phoneFieldError('4392', true, undefined, message)).toBe(message)
    expect(phoneFieldError('43921', true, undefined, message)).toBe(message)
    expect(phoneFieldError('43921437', true, undefined, message)).toBeUndefined()
    // Emptied while checking: no error until Save.
    expect(phoneFieldError('', true, undefined, message)).toBeUndefined()
    // The form's own error (e.g. "required" after Save) shows until there are 8 digits.
    expect(phoneFieldError('', false, 'Enter a phone number.', message)).toBe('Enter a phone number.')
    expect(phoneFieldError('43921437', false, message, message)).toBeUndefined()
  })

  it('is no unsaved change in the staff form while the field shows the stored number’s 8 digits', () => {
    // Edit Staff opens with the stored number; the field shows 43921437 after "+9665" and keeps "+9665" + the digits.
    const stored: NewUser = { name: 'Rana', email: 'rana@hawkim.demo', phone: '+966543921437', position: 'QA Specialist', divisionId: 'qa-division', departmentId: 'qa', permissions: ['author'] }
    const shown = phoneDigitsOf(stored.phone)
    expect(shown).toBe('43921437')
    expect(hasUnsavedChanges(stored, { ...stored, phone: phoneValue(shown) })).toBe(false)
    // Typed again after a paste of the full number: still no change.
    expect(hasUnsavedChanges(stored, { ...stored, phone: phoneValue(phoneInput('+966 54 392 1437', true)) })).toBe(false)
    // A different number is a change; so is anything typed on Add Staff.
    expect(hasUnsavedChanges(stored, { ...stored, phone: phoneValue('43921438') })).toBe(true)
    const empty: NewUser = { name: '', email: '', phone: '', position: '', departmentId: '', permissions: [] }
    expect(hasUnsavedChanges(empty, { ...empty, phone: phoneValue('4') })).toBe(true)
    expect(hasUnsavedChanges(empty, { ...empty, phone: phoneValue('') })).toBe(false)
  })
})
