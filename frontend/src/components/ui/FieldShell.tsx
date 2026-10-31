import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'

interface FieldShellProps {
  label: string
  inputId: string
  hint?: string
  hintId: string
  error?: string
  errorId: string
  /** Extra content on the right of the hint/error line (e.g. a character counter). */
  aside?: ReactNode
  /** Keeps the label for screen readers only, e.g. when the dialog title already names the field. */
  hideLabel?: boolean
  /** Shows a red asterisk after the label (visual only; mark the control itself as required too). */
  requiredMark?: boolean
  className?: string
  children: ReactNode
}

/** Red asterisk after the label of a required field; hidden from screen readers. */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-status-rejected-fg">
      *
    </span>
  )
}

/**
 * Label + control + hint/inline error, shared by TextField, SelectField and TextAreaField.
 * Use with `useFieldIds()` so the ids and aria-describedby line up.
 */
export function FieldShell({ label, inputId, hint, hintId, error, errorId, aside, hideLabel = false, requiredMark = false, className = '', children }: FieldShellProps) {
  const message = error ? (
    <p id={errorId} className="flex items-start gap-1.5 text-sm text-maroon-secondary">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      {error}
    </p>
  ) : (
    hint && (
      <p id={hintId} className="text-sm text-text-gray">
        {hint}
      </p>
    )
  )

  return (
    <div className={className}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'mb-1.5 block text-sm font-medium text-maroon'}>
        {label}
        {requiredMark && <RequiredMark />}
      </label>
      {children}
      {(message || aside) && (
        <div className="mt-1.5 flex items-start justify-between gap-3">
          <div className="min-w-0">{message}</div>
          {aside}
        </div>
      )}
    </div>
  )
}
