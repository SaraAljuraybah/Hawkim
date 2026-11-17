import type { RefObject } from 'react'
import type { AdminAddUserContent } from '../../content/types'
import type { Department } from '../../data/mock/types'
import { divisionNameIn, divisionOptions } from '../../lib/userAdmin'
import { SelectCombobox } from '../ui/SelectCombobox'

interface DivisionFieldProps {
  /** The departments a user can join (each division among them is a choice). */
  departments: Pick<Department, 'divisionId' | 'divisionName'>[]
  content: AdminAddUserContent['division']
  /** A division or ''. */
  value: string
  error?: string
  onChange: (division: string) => void
  onBlur?: (division: string) => void
  inputRef?: RefObject<HTMLInputElement | null>
  className?: string
}

/**
 * The required Division of a user, chosen before the department: a searchable list of the
 * departments' divisions (every department has one).
 */
export function DivisionField({ departments, content, value, error, onChange, onBlur, inputRef, className }: DivisionFieldProps) {
  const options = divisionOptions(departments).map((division) => ({
    value: division,
    label: divisionNameIn(departments, division),
  }))
  return (
    <SelectCombobox
      inputRef={inputRef}
      name="division"
      label={content.label}
      placeholder={content.placeholder}
      options={options}
      value={value}
      error={error}
      required
      requiredMark
      toggleLabel={content.toggle}
      noMatchesText={content.noMatches}
      onChange={onChange}
      onBlur={onBlur}
      className={className}
    />
  )
}
