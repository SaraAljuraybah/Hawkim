import { useId, useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { TextField, type TextFieldProps } from './TextField'

export interface PasswordFieldProps extends Omit<TextFieldProps, 'type' | 'endAdornment' | 'startIcon'> {
  /** Accessible label for the toggle while the password is hidden. */
  showLabel: string
  /** Accessible label for the toggle while the password is visible. */
  hideLabel: string
  /** Shows a decorative lock icon at the start of the input. */
  lockIcon?: boolean
}

/** Password input built on TextField, with a show/hide visibility toggle. */
export function PasswordField({ showLabel, hideLabel, lockIcon = false, id, ...fieldProps }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  const generatedId = useId()
  const inputId = id ?? generatedId

  // The icon shows the current state: a crossed-out eye while hidden, an open eye while visible.
  const toggle = (
    <button
      type="button"
      onClick={() => setVisible((v) => !v)}
      aria-label={visible ? hideLabel : showLabel}
      aria-controls={inputId}
      className="inline-flex size-9 items-center justify-center rounded-md text-text-gray transition-colors hover:bg-beige hover:text-maroon"
    >
      {visible ? (
        <Eye aria-hidden="true" className="size-5" strokeWidth={1.75} />
      ) : (
        <EyeOff aria-hidden="true" className="size-5" strokeWidth={1.75} />
      )}
    </button>
  )

  return (
    <TextField
      {...fieldProps}
      id={inputId}
      type={visible ? 'text' : 'password'}
      endAdornment={toggle}
      startIcon={lockIcon ? <Lock aria-hidden="true" className="size-4" strokeWidth={1.75} /> : undefined}
    />
  )
}
