import type { FocusEventHandler, Ref } from 'react'
import type { AdminAddUserContent } from '../../content/types'
import type { Department } from '../../data/mock/types'
import { divisionsOf } from '../../lib/userAdmin'
import { SelectField } from '../ui/SelectField'

interface DivisionFieldProps {
  /** The selected department, if any. */
  department?: Department
  content: AdminAddUserContent['division']
  value: string
  error?: string
  onChange: (divisionId: string) => void
  onBlur?: FocusEventHandler<HTMLSelectElement>
  ref?: Ref<HTMLSelectElement>
  className?: string
}

/**
 * The division of the selected department. Disabled until a department is selected, and for a
 * department without a division, where it isn't required.
 */
export function DivisionField({ department, content, value, error, onChange, onBlur, ref, className }: DivisionFieldProps) {
  const divisions = divisionsOf(department)
  const required = divisions.length > 0
  const placeholder = !department ? content.selectDepartmentFirst : required ? content.placeholder : content.none
  return (
    <SelectField
      ref={ref}
      name="division"
      label={content.label}
      placeholder={placeholder}
      options={divisions.map((division) => ({ value: division, label: division }))}
      value={value}
      error={error}
      disabled={!required}
      required={required}
      requiredMark={required}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      className={className}
    />
  )
}
