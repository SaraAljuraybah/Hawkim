import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { CircleAlert } from 'lucide-react'

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
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`

  const describedByIds =
    [describedBy, error ? errorId : hint ? hintId : undefined].filter(Boolean).join(' ') || undefined

  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-maroon">
        {label}
      </label>

      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds}
          className={`h-11 w-full rounded-lg border bg-white px-3.5 text-[0.9375rem] text-maroon transition-colors placeholder:text-text-gray/85 focus:border-maroon focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-beige ${
            error ? 'border-maroon-secondary' : 'border-text-gray/70'
          } ${endAdornment ? 'pr-12' : ''}`}
          {...inputProps}
        />
        {endAdornment && (
          <div className="absolute inset-y-0 right-1 flex items-center">{endAdornment}</div>
        )}
      </div>

      {error ? (
        <p id={errorId} className="mt-1.5 flex items-start gap-1.5 text-sm text-maroon-secondary">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="mt-1.5 text-sm text-text-gray">
            {hint}
          </p>
        )
      )}
    </div>
  )
}
