import { describe, expect, it } from 'vitest'
import { REVIEW_NOTE_EDITOR_MAX, prepareReviewSubmission } from './reviewSubmission'

describe('review request form validation', () => {
  const eligible = ['first', 'second']
  const now = new Date('2026-10-29T09:00:00+03:00')
  const prepare = (selected: string[], duration: string, note: string) => prepareReviewSubmission(selected, eligible, duration, note, now)
  it('retains optional duration and independent multiple-reviewer submission', () => {
    expect(prepare(eligible, '', '')).toEqual({ options: { reviewerIds: eligible, responseDueDate: '2026-11-02', reviewDurationDays: undefined, note: undefined } })
    expect(prepare(eligible, '30', 'Review this version')).toEqual({ options: { reviewerIds: eligible, responseDueDate: '2026-11-02', reviewDurationDays: 30, note: 'Review this version' } })
  })

  it.each([[], ['author'], ['coauthor'], ['foreign'], ['first', 'first'], ['first', 'foreign']].map((selected) => ({ selected })))('rejects missing, duplicate or ineligible reviewers: $selected', ({ selected }) => {
    expect(prepare(selected, '', '')).toEqual({ error: 'reviewers' })
  })

  it.each(['0', '31', '-1', '1.5', 'NaN', 'invalid'])('rejects unsupported duration %s', (days) => {
    expect(prepare(['first'], days, '')).toEqual({ error: 'duration' })
  })

  it('uses the same 1000-character limit for the editor and submission validation', () => {
    expect(REVIEW_NOTE_EDITOR_MAX).toBe(1000)
    for (const length of [500, 501, 1000]) {
      const note = 'x'.repeat(length)
      expect(prepare(['first'], '5', note)).toHaveProperty('options.note', note)
    }
    const tooLong = 'x'.repeat(1001)
    expect(prepare(['first'], '5', tooLong)).toEqual({ error: 'note' })
    expect(tooLong).toHaveLength(1001)
    // Trim surrounding whitespace without truncating the submitted comment.
    expect(prepare(['first'], '', ` ${'x'.repeat(1000)} `)).toHaveProperty('options.note', 'x'.repeat(1000))
  })

  it('always supplies the fixed shared response date, recalculated from confirmation time', () => {
    const before = prepareReviewSubmission(eligible, eligible, '5', '', new Date('2026-10-28T20:59:59Z'))
    const after = prepareReviewSubmission(eligible, eligible, '5', '', new Date('2026-10-28T21:00:00Z'))
    expect(before).toHaveProperty('options.responseDueDate', '2026-11-01')
    expect(after).toHaveProperty('options.responseDueDate', '2026-11-02')
    expect(after).toHaveProperty('options.reviewerIds', eligible)
  })
})
