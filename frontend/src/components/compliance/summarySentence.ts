import type { ComplianceContent } from '../../content/types'
import type { ComplianceCheck } from '../../data/mock/types'
import { countResults } from '../../lib/compliance'
import type { SopStatus } from '../../types/status'

/**
 * "1 conflict and 1 partially compliant requirement need attention before submitting for review.
 * 2 requirements need human review." Human review is a sentence of its own.
 */
export function summarySentence(check: ComplianceCheck, status: SopStatus, text: ComplianceContent['report']['summary']): string {
  const counts = countResults(check)
  const phrase = (key: 'conflict' | 'not-addressed' | 'partial') =>
    (counts[key] === 1 ? text.attention[key].one : text.attention[key].other).replace('{count}', String(counts[key]))
  const keys = (['conflict', 'partial'] as const).filter((key) => counts[key] > 0)
  const sentences: string[] = []
  if (keys.length > 0) {
    const parts = keys.map(phrase)
    const items = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} ${text.and} ${parts[parts.length - 1]}`
    const total = keys.reduce((sum, key) => sum + counts[key], 0)
    // "…before submitting for review" only while the author can still (re)submit.
    const template = status === 'draft' || status === 'returned' ? text.beforeSubmit : text.needsAttention
    sentences.push((total === 1 ? template.one : template.other).replace('{items}', items))
  }
  if (counts['not-addressed'] > 0) sentences.push(phrase('not-addressed'))
  return sentences.length > 0 ? sentences.join(' ') : text.allCompliant
}
