import { useId, type ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { RequiredMark } from './FieldShell'

/** What each of the two fields gets from the group: link it with aria-describedby, and mark it invalid. */
export interface EitherFieldProps {
  'aria-describedby': string
  invalid: boolean
}

interface EitherFieldGroupProps {
  legend: string
  /** Says the rule (e.g. "Enter an address, a Google Maps link, or both."); linked to the group and to both fields. */
  hint: string
  /** The word shown between the two fields (hidden from screen readers: the hint says it). */
  orLabel: string
  /** The group's error (e.g. both empty); linked to the group and to both fields, which are marked invalid. */
  error?: string
  /** Red asterisk after the legend when the group is required (at least one of the two). */
  requiredMark?: boolean
  first: (props: EitherFieldProps) => ReactNode
  second: (props: EitherFieldProps) => ReactNode
  className?: string
}

/**
 * Two fields where one is enough (or both), in one box: a legend, the rule as a hint, the fields side by side
 * with "or" between them (stacked on phones), and one error for the group. The fields keep their own labels
 * and their own errors (e.g. a link that isn't valid).
 */
export function EitherFieldGroup({ legend, hint, orLabel, error, requiredMark = false, first, second, className = '' }: EitherFieldGroupProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = error ? `${hintId} ${errorId}` : hintId
  const fieldProps: EitherFieldProps = { 'aria-describedby': describedBy, invalid: !!error }

  return (
    <fieldset aria-describedby={describedBy} className={`min-w-0 rounded-lg border p-4 ${error ? 'border-maroon-secondary' : 'border-beige'} ${className}`}>
      <legend className="px-1 text-sm font-bold text-maroon">
        {legend}
        {requiredMark && <RequiredMark />}
      </legend>
      <p id={hintId} className="mb-3 text-sm text-text-gray">{hint}</p>
      <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-4">
        {first(fieldProps)}
        {/* Lined up with the middle of the inputs (below their labels) side by side. */}
        <span aria-hidden="true" className="text-center text-sm font-medium text-text-gray sm:mt-[2.375rem]">{orLabel}</span>
        {second(fieldProps)}
      </div>
      {error && (
        <p id={errorId} className="mt-3 flex items-start gap-1.5 text-sm text-maroon-secondary">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          {error}
        </p>
      )}
    </fieldset>
  )
}
