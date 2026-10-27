import type { InputHTMLAttributes, ReactNode, Ref } from 'react'
import { FieldShell } from './FieldShell'
import { controlClasses, useFieldIds } from './useFieldIds'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> {
  label: string
  /** Helper text shown under the input (hidden while an error is shown). */
  hint?: string
  /** Error message; also marks the input as invalid for assistive technology. */
  error?: string
  /** Marks the input as invalid without an inline error, e.g. while the error is shown in a pop-up. */
  invalid?: boolean
  /** Shows a red asterisk after the label. Pass `required` as well so screen readers announce it. */
  requiredMark?: boolean
  /**
   * Character counter text shown under the field on the right (e.g. "12 / 50").
   * It is linked with aria-describedby but not announced on every keystroke.
   */
  counter?: string
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
  invalid = false,
  requiredMark = false,
  counter,
  endAdornment,
  ref,
  id,
  className = '',
  'aria-describedby': describedBy,
  ...inputProps
}: TextFieldProps) {
  const fieldIds = useFieldIds({ id, hint, error, describedBy })
  const { inputId, hintId, errorId } = fieldIds
  const counterId = `${inputId}-counter`
  const describedByIds = [fieldIds.describedByIds, counter ? counterId : undefined].filter(Boolean).join(' ') || undefined

  return (
    <FieldShell
      label={label}
      inputId={inputId}
      hint={hint}
      hintId={hintId}
      error={error}
      errorId={errorId}
      requiredMark={requiredMark}
      className={className}
      aside={
        counter && (
          <p id={counterId} className="shrink-0 text-sm text-text-gray tabular-nums">
            {counter}
          </p>
        )
      }
    >
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error || invalid ? true : undefined}
          aria-describedby={describedByIds}
          className={`h-11 ${controlClasses(error || (invalid ? 'invalid' : undefined))} ${endAdornment ? 'pr-12' : ''}`}
          {...inputProps}
        />
        {endAdornment && (
          <div className="absolute inset-y-0 right-1 flex items-center">{endAdornment}</div>
        )}
      </div>
    </FieldShell>
  )
}
