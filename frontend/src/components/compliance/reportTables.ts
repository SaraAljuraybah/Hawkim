import type { CheckProcedure, Requirement } from '../../data/mock/types'
import type { NumberedFinding } from '../../lib/compliance'

/** How long a procedure's excerpt is, at most, before "Show more" (in characters, "…" included). */
export const EXCERPT_LENGTH = 160

/**
 * The requirements a check assessed: each requirement with at least one finding, once, in code order
 * (R1, R2… R10; I.B.7#2 before I.B.7#10), with its details from the report's lookup. A requirement the
 * lookup doesn't know is still listed, by its code, with no other details.
 */
export function assessedRequirements(
  findings: NumberedFinding[],
  getRequirement: (id: string) => Requirement | undefined,
): Requirement[] {
  const ids = [...new Set(findings.map((finding) => finding.requirementId))]
  return ids
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((id) => getRequirement(id) ?? { id, module: '', section: '', sectionTitle: '', shortTitle: '', page: 0, summary: '' })
}

/** A requirement's findings, in the report's order. */
export function findingsOfRequirement(findings: NumberedFinding[], requirementId: string): NumberedFinding[] {
  return findings.filter((finding) => finding.requirementId === requirementId)
}

/** The findings based on a procedure (by its chunk id: Finding.procedureIds), in the report's order. */
export function findingsOfProcedure(findings: NumberedFinding[], procedure: Pick<CheckProcedure, 'chunkId'>): NumberedFinding[] {
  return findings.filter((finding) => finding.procedureIds?.includes(procedure.chunkId))
}

/**
 * The start of a text on one line (whitespace collapsed): the whole text when it fits in `max`
 * characters, else cut at the last space before the limit (or at the limit, for one long word) with "…".
 */
export function excerpt(text: string, max = EXCERPT_LENGTH): { text: string; cut: boolean } {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return { text: flat, cut: false }
  const head = flat.slice(0, max - 1)
  const space = head.lastIndexOf(' ')
  return { text: `${(space > max / 2 ? head.slice(0, space) : head).trimEnd()}…`, cut: true }
}
