import { useId, useRef, useState, type Ref } from 'react'
import { checksOnBlur, isCompletePhone, PHONE_PREFIX, phoneDigitsOf, phoneFieldError, phoneInput, phoneValue } from '../../lib/phone'
import { TextField } from './TextField'

interface PhoneFieldProps {
  name: string
  label: string
  hint: string
  /** The form's value: "+9665" and the digits typed, or '' (a stored number shows its 8 digits). */
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  /** The form's error (e.g. after Save). */
  error?: string
  /** Shown as soon as the field is left with something other than exactly 8 digits. */
  invalidMessage: string
  required?: boolean
  requiredMark?: boolean
  autoComplete?: string
  ref?: Ref<HTMLInputElement>
  className?: string
}

/**
 * A Saudi mobile number: a fixed "+9665" before the field and the 8 digits typed in it, with the number
 * keyboard on phones. Pasted or autofilled whole numbers are cut down to the 8 digits. Leaving the field
 * with a wrong number of digits (but not empty) shows `invalidMessage` at once; from then on it
 * re-checks as they type and clears at exactly 8 digits. The prefix is read before the hint or error.
 */
export function PhoneField({ name, label, hint, value, onChange, onBlur, error, invalidMessage, required, requiredMark, autoComplete = 'off', ref, className }: PhoneFieldProps) {
  const prefixId = useId()
  // The stored number's digits, or the digits typed (kept in the value after the prefix).
  const digits = phoneDigitsOf(value) || value.replace(PHONE_PREFIX, '')
  // Shown since leaving the field with a wrong number of digits, until there are exactly 8.
  const [checking, setChecking] = useState(false)
  const pasted = useRef(false)
  const shown = phoneFieldError(digits, checking, error, invalidMessage)

  return (
    <TextField
      ref={ref}
      name={name}
      type="text"
      inputMode="numeric"
      autoComplete={autoComplete}
      label={label}
      hint={hint}
      error={shown}
      required={required}
      requiredMark={requiredMark || !!required}
      className={className}
      aria-describedby={prefixId}
      startAdornment={<span id={prefixId}>{PHONE_PREFIX}</span>}
      value={digits}
      onPaste={() => { pasted.current = true }}
      onChange={(event) => {
        // A paste, or autofill (more than one character at once).
        const next = phoneInput(event.target.value, pasted.current || event.target.value.length - digits.length > 1)
        pasted.current = false
        if (isCompletePhone(next)) setChecking(false)
        onChange(phoneValue(next))
      }}
      onBlur={() => {
        if (checksOnBlur(digits)) setChecking(true)
        onBlur?.()
      }}
    />
  )
}
