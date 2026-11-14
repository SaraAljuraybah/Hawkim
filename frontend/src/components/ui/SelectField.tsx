import type { Ref, SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { FieldShell } from './FieldShell'
import { controlClasses, useFieldIds } from './useFieldIds'

export interface SelectOption {
  value: string
  label: string
  /** Options with the same group are listed together under that heading (a native <optgroup>). */
  group?: string
}

/** Options without a group first, then each group in the order it first appears. */
function groupOptions(options: SelectOption[]): { group?: string; options: SelectOption[] }[] {
  const sections: { group?: string; options: SelectOption[] }[] = []
  for (const option of options) {
    const section = sections.find((item) => item.group === option.group)
    if (section) section.options.push(option)
    else sections.push({ group: option.group, options: [option] })
  }
  return sections.sort((a, b) => Number(a.group !== undefined) - Number(b.group !== undefined))
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: string
  options: SelectOption[]
  /** Text of the empty first option (e.g. "Select request type"); it cannot be chosen. */
  placeholder?: string
  hint?: string
  error?: string
  /** Shows a red asterisk after the label. It is shown by itself for a `required` field (always matching what is checked); pass true to show it without `required`. */
  requiredMark?: boolean
  ref?: Ref<HTMLSelectElement>
  className?: string
}

/** Labelled native <select> with the same hint/error pattern as TextField. */
export function SelectField({
  label,
  options,
  placeholder,
  hint,
  error,
  requiredMark = false,
  ref,
  id,
  value,
  className = '',
  'aria-describedby': describedBy,
  ...selectProps
}: SelectFieldProps) {
  const { inputId, hintId, errorId, describedByIds } = useFieldIds({ id, hint, error, describedBy })
  const showingPlaceholder = value === '' || value === undefined

  return (
    <FieldShell label={label} inputId={inputId} hint={hint} hintId={hintId} error={error} errorId={errorId} requiredMark={requiredMark || !!selectProps.required} className={className}>
      <div className="relative">
        <select
          ref={ref}
          id={inputId}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds}
          className={`h-11 appearance-none pr-10 ${controlClasses(error)} ${showingPlaceholder ? 'text-text-gray' : ''}`}
          {...selectProps}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {groupOptions(options).map((section) => {
            const items = section.options.map((option) => (
              <option key={option.value} value={option.value} className="text-maroon">
                {option.label}
              </option>
            ))
            return section.group === undefined ? items : <optgroup key={section.group} label={section.group}>{items}</optgroup>
          })}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-text-gray"
          strokeWidth={1.75}
        />
      </div>
    </FieldShell>
  )
}
