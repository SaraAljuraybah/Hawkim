import type { Ref, TextareaHTMLAttributes } from 'react'
import { FieldShell } from './FieldShell'
import { controlClasses, useFieldIds } from './useFieldIds'

export interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'children'> {
  label: string
  hint?: string
  error?: string
  /**
   * Character counter text shown under the field on the right (e.g. "120 / 1000").
   * It is linked with aria-describedby but not announced on every keystroke.
   */
  counter?: string
  ref?: Ref<HTMLTextAreaElement>
  className?: string
}

/** Labelled multi-line text field with the same hint/error pattern as TextField. */
export function TextAreaField({
  label,
  hint,
  error,
  counter,
  ref,
  id,
  rows = 5,
  className = '',
  'aria-describedby': describedBy,
  ...textareaProps
}: TextAreaFieldProps) {
  const fieldIds = useFieldIds({ id, hint, error })
  const counterId = `${fieldIds.inputId}-counter`
  const describedByIds = [describedBy, fieldIds.describedByIds, counter ? counterId : undefined].filter(Boolean).join(' ') || undefined

  return (
    <FieldShell
      label={label}
      inputId={fieldIds.inputId}
      hint={hint}
      hintId={fieldIds.hintId}
      error={error}
      errorId={fieldIds.errorId}
      className={className}
      aside={
        counter && (
          <p id={counterId} className="shrink-0 text-sm text-text-gray tabular-nums">
            {counter}
          </p>
        )
      }
    >
      <textarea
        ref={ref}
        id={fieldIds.inputId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedByIds}
        className={`block min-h-28 resize-y py-2.5 leading-relaxed ${controlClasses(error)}`}
        {...textareaProps}
      />
    </FieldShell>
  )
}
