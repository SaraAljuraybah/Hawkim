import type { ComplianceContent } from '../../content/types'
import type { Requirement } from '../../data/mock/types'

/**
 * The title and reference shown in the Requirements Overview, read from the requirement's own fields
 * (its stored code, e.g. "V.B.2#4", is used unchanged everywhere else):
 * - title: its section title, or "—" when there is none (the service then stores the section again);
 * - reference: its section, e.g. "V.B.2".
 * An unknown requirement shows "—" and its code up to any "#" (the whole code when there's nothing before it).
 */
export function overviewCells(
  text: ComplianceContent['report'],
  requirementId: string,
  getRequirement: (id: string) => Requirement | undefined,
): { title: string; reference: string } {
  const fromCode = requirementId.split('#')[0].trim() || requirementId
  const requirement = getRequirement(requirementId)
  if (!requirement) return { title: text.overview.none, reference: fromCode }
  const section = requirement.section?.trim() ?? ''
  const title = requirement.sectionTitle?.trim() ?? ''
  return { title: title && title !== section ? title : text.overview.none, reference: section || fromCode }
}
