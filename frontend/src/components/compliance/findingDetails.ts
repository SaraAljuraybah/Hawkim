import type { Requirement } from '../../data/mock/types'

/** A paragraph, or the "•" items that follow it as a list. */
export type TextBlock = { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] }

/**
 * Splits a finding's text into paragraphs and lists: every "•" item becomes a list item, whether the
 * items are on their own lines (GVP text) or run together on one line (SOP text). Text before the
 * first "•" of a line is a paragraph. Only "•" counts as a bullet, so dashes and numbers stay text.
 */
export function textBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = []
  for (const line of text.split(/\r?\n/)) {
    const [lead, ...items] = line.split('•')
    if (lead.trim()) blocks.push({ kind: 'paragraph', text: lead.trim() })
    for (const item of items.map((part) => part.trim()).filter(Boolean)) {
      const last = blocks.at(-1)
      if (last?.kind === 'list') last.items.push(item)
      else blocks.push({ kind: 'list', items: [item] })
    }
  }
  return blocks
}

/**
 * The requirement text without the compliance service's "[Context: …]" label: a requirement that
 * starts by referring back ("This should include…") gets the previous GVP sentence in front of it,
 * labelled. The sentence stays, as the first paragraph; only the label and brackets go.
 */
export function withoutContextLabel(text: string): string {
  const match = /^\[Context:[ \t]*(.*)\][ \t]*(?:\r?\n|$)/.exec(text)
  if (!match) return text
  const context = match[1].trim()
  const rest = text.slice(match[0].length)
  return context ? `${context}\n${rest}` : rest
}

/**
 * The Module, Section and Page lines of a finding: "V" (from "Module V", or the section's first
 * part), "V.B.2 Responsibilities…" (no title when it's empty or repeats the section) and "107".
 * `none` ("—") for a missing value.
 */
export function requirementLines(requirement: Requirement, none: string): { module: string; section: string; page: string } {
  const section = requirement.section?.trim() ?? ''
  const title = requirement.sectionTitle?.trim() ?? ''
  const module = (requirement.module?.trim() ?? '').replace(/^Module\s+/i, '').trim() || section.split('.')[0].trim()
  const hasTitle = Boolean(title) && title !== section
  return {
    module: module || none,
    section: hasTitle ? (section ? `${section} ${title}` : title) : section || none,
    page: Number.isInteger(requirement.page) && requirement.page > 0 ? String(requirement.page) : none,
  }
}

/**
 * The section labels of a finding's SOP reference, as the compliance service writes it
 * (aggregate.py: "Section 5-4-1", or "Sections 5-4-1, 5-4-2", sorted and each once): "Section 5-4-1"
 * for a section number, "Section number not found" for anything else (an unnumbered heading, or
 * "(start of document)" when the SOP has no headings), each label once. Undefined for a reference in
 * another form, which is shown as it is.
 */
export function sectionLabels(reference: string, text: { stepSection: string; noSectionNumber: string }): string[] | undefined {
  const match = /^Sections? (.+)$/.exec(reference.trim())
  if (!match) return undefined
  const labels = match[1].split(', ').map((part) => {
    const section = part.trim()
    return /^\d+(?:[.-]\d+)*$/.test(section) ? text.stepSection.replace('{section}', section) : text.noSectionNumber
  })
  return labels.filter((label, index) => labels.indexOf(label) === index)
}
