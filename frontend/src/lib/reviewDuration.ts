import { sopWorkflowEn } from '../content/workflow.en'

/** Display elapsed timestamp allocations without rounding a partial day up to 24 hours. */
export function formatReviewDuration(milliseconds: number): string {
  if (milliseconds > 0 && milliseconds < 1_000) return sopWorkflowEn.reviewerDeadline.lessThanSecond
  let seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const parts: string[] = []
  for (const [unit, size] of [['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1]] as const) {
    const count = Math.floor(seconds / size)
    seconds %= size
    if (count > 0) parts.push(new Intl.NumberFormat('en', { style: 'unit', unit, unitDisplay: 'long' }).format(count))
    if (parts.length === 2) break
  }
  return parts.join(' ') || new Intl.NumberFormat('en', { style: 'unit', unit: 'second', unitDisplay: 'long' }).format(0)
}
