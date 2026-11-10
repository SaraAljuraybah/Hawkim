import type { CountText } from '../../content/types'

/** The field's text: each section with choices, e.g. "2 divisions, 1 department"; '' with none. */
export function filterSummary(sections: { value: string[]; summary: CountText }[]): string {
  return sections
    .filter((section) => section.value.length > 0)
    .map((section) => (section.value.length === 1 ? section.summary.one : section.summary.other).replace('{count}', String(section.value.length)))
    .join(', ')
}
