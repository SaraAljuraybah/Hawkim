import type { FilterSection } from './FilterPopover'

/**
 * What a FilterPopover's Clear all does: `onClear` when given (one change, for filters kept in the
 * URL), otherwise every section emptied in turn (plain state). Kept apart from the component so its
 * file only exports components.
 */
export function clearFilterSections(sections: FilterSection[], onClear?: () => void) {
  if (onClear) onClear()
  else sections.forEach((section) => section.onChange([]))
}
