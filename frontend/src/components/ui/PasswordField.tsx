import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { TextField, type TextFieldProps } from './TextField'

export interface PasswordFieldProps extends Omit<TextFieldProps, 'type' | 'endAdornment'> {
  /** Accessible label for the toggle while the password is hidden. */
  showLabel: string
  /** Accessible label for the toggle while the password is visible. */
  hideLabel: string
}

/** Password input built on TextField, with a show/hide visibility toggle. */
export function PasswordField({ showLabel, hideLabel, id, ...fieldProps }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  const generatedId = useId()
  const inputId = id ?? generatedId

  const toggle = (
    <button
      type="button"
      onClick={() => setVisible((v) => !v)}
      aria-label={visible ? hideLabel : showLabel}
      aria-controls={inputId}
      className="inline-flex size-9 items-center justify-center rounded-md text-text-gray transition-colors hover:bg-beige hover:text-maroon"
    >
      {visible ? (
        <EyeOff aria-hidden="true" className="size-5" strokeWidth={1.75} />
      ) : (
        <Eye aria-hidden="true" className="size-5" strokeWidth={1.75} />
      )}
    </button>
  )

  return <TextField {...fieldProps} id={inputId} type={visible ? 'text' : 'password'} endAdornment={toggle} />
}
