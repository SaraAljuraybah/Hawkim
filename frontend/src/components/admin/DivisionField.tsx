import type { RefObject } from 'react'
import type { AdminAddUserContent } from '../../content/types'
import type { Department } from '../../data/mock/types'
import { divisionNameIn, divisionOptions, NO_DIVISION } from '../../lib/userAdmin'
import { SelectCombobox } from '../ui/SelectCombobox'

interface DivisionFieldProps {
  /** The departments a user can join (each division among them is a choice). */
  departments: Pick<Department, 'divisionId' | 'divisionName'>[]
  content: AdminAddUserContent['division']
  /** A division, NO_DIVISION or ''. */
  value: string
  error?: string
  onChange: (division: string) => void
  onBlur?: (division: string) => void
  inputRef?: RefObject<HTMLInputElement | null>
  className?: string
}

/**
 * The required Division of a new user, chosen before the department: a searchable list of the
 * departments' divisions, plus "No Division" for departments without one.
 */
export function DivisionField({ departments, content, value, error, onChange, onBlur, inputRef, className }: DivisionFieldProps) {
  const options = divisionOptions(departments).map((division) => ({
    value: division,
    label: division === NO_DIVISION ? content.noDivision : divisionNameIn(departments, division),
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
