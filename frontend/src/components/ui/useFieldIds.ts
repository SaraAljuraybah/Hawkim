import { useId } from 'react'

interface FieldIdOptions {
  id?: string
  hint?: string
  error?: string
  /** Extra ids to include in aria-describedby (e.g. a character counter). */
  describedBy?: string
}

/**
 * Ids shared by form fields: the control id plus hint/error ids, and the
 * aria-describedby value (the error replaces the hint while it is shown).
 */
export function useFieldIds({ id, hint, error, describedBy }: FieldIdOptions) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const describedByIds =
    [describedBy, error ? errorId : hint ? hintId : undefined].filter(Boolean).join(' ') || undefined

  return { inputId, hintId, errorId, describedByIds }
}

/** Border/background classes shared by text inputs, selects and textareas. */
export function controlClasses(error?: string) {
  return `w-full rounded-lg border bg-white px-3.5 text-[0.9375rem] text-maroon transition-colors placeholder:text-text-gray/85 focus:border-maroon focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-beige ${
    error ? 'border-maroon-secondary' : 'border-text-gray/70'
  }`
}
