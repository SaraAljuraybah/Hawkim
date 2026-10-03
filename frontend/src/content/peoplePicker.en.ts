/*
 * English text for the searchable people picker (components/ui/PeoplePicker).
 * Each form gives its own label, hint and errors; this is the picker's own text.
 */

import type { PeoplePickerContent } from './types'

export const peoplePickerEn: PeoplePickerContent = {
  placeholder: 'Search by name or department…',
  noMatches: 'No matching people',
  selected: 'Selected: {label}',
  remove: 'Remove {name}',
  added: '{name} added.',
  removed: '{name} removed.',
}
