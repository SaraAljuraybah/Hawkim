import { useId, type ReactNode, type Ref } from 'react'
import { CircleAlert } from 'lucide-react'

export interface CheckboxOption {
  value: string
  label: string
  /** Secondary line under the label (e.g. a department). */
  description?: string
}

interface CheckboxGroupProps {
  /** Name shared by the checkboxes. */
  name: string
  legend: string
  hint?: string
  error?: string
  options: CheckboxOption[]
  /** Checked values. */
  value: string[]
  onChange: (next: string[]) => void
  /** Ref to the first checkbox, so a form can move focus here on an error. */
  firstRef?: Ref<HTMLInputElement>
  /** Shown instead of the list when there are no options. */
  emptyText?: string
  /** Extra content under the list (e.g. a note about changes). */
  children?: ReactNode
  className?: string
}

/**
 * Fieldset of checkboxes with a legend, hint and inline error, in the same
 * style as the other form fields. The hint or error is linked to the group.
 */
export function CheckboxGroup({
  name,
  legend,
  hint,
  error,
  options,
  value,
  onChange,
  firstRef,
  emptyText,
  children,
  className = '',
}: CheckboxGroupProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  function toggle(optionValue: string, checked: boolean) {
    onChange(checked ? [...value, optionValue] : value.filter((v) => v !== optionValue))
  }

  return (
    <fieldset aria-describedby={error ? errorId : hint ? hintId : undefined} className={`min-w-0 ${className}`}>
      <legend className="mb-1.5 text-sm font-medium text-maroon">{legend}</legend>
      {hint && !error && (
        <p id={hintId} className="mb-2 text-sm text-text-gray">
          {hint}
        </p>
      )}
      {options.length === 0 ? (
        emptyText && <p className="text-sm text-text-gray">{emptyText}</p>
      ) : (
        <ul
          className={`divide-y divide-beige rounded-lg border bg-white ${error ? 'border-maroon-secondary' : 'border-text-gray/40'}`}
        >
          {options.map((option, index) => (
            <li key={option.value}>
              <label className="flex cursor-pointer items-start gap-3 px-3.5 py-2.5">
                <input
                  ref={index === 0 ? firstRef : undefined}
                  type="checkbox"
                  name={name}
                  value={option.value}
                  checked={value.includes(option.value)}
                  aria-invalid={error ? true : undefined}
                  onChange={(event) => toggle(option.value, event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-maroon"
                />
                <span className="min-w-0">
                  <span className="block text-[0.9375rem] text-maroon">{option.label}</span>
                  {option.description && <span className="block text-sm text-text-gray">{option.description}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 flex items-start gap-1.5 text-sm text-maroon-secondary">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          {error}
        </p>
      )}
      {children}
    </fieldset>
  )
}
