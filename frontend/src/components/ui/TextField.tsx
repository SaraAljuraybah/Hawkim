import type { InputHTMLAttributes, ReactNode, Ref } from 'react'
import { FieldShell } from './FieldShell'
import { controlClasses, useFieldIds } from './useFieldIds'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> {
  label: string
  /** Helper text shown under the input (hidden while an error is shown). */
  hint?: string
  /** Error message; also marks the input as invalid for assistive technology. */
  error?: string
  /** Element placed inside the input on the right, e.g. a visibility toggle. */
  endAdornment?: ReactNode
  /** Forwarded to the `<input>` (React 19 passes refs as regular props). */
  ref?: Ref<HTMLInputElement>
  /** Classes for the outer wrapper. */
  className?: string
}

/**
 * Labelled text input with optional hint and inline error.
 * The hint/error are linked to the input with `aria-describedby`, and
 * `aria-invalid` is set while there is an error.
 */
export function TextField({
  label,
  hint,
  error,
  endAdornment,
  ref,
  id,
  className = '',
  'aria-describedby': describedBy,
  ...inputProps
}: TextFieldProps) {
  const { inputId, hintId, errorId, describedByIds } = useFieldIds({ id, hint, error, describedBy })

  return (
    <FieldShell
      label={label}
      inputId={inputId}
      hint={hint}
      hintId={hintId}
      error={error}
      errorId={errorId}
      className={className}
    >
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds}
          className={`h-11 ${controlClasses(error)} ${endAdornment ? 'pr-12' : ''}`}
          {...inputProps}
        />
        {endAdornment && (
          <div className="absolute inset-y-0 right-1 flex items-center">{endAdornment}</div>
        )}
      </div>
    </FieldShell>
  )
}
