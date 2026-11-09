import { describe, expect, it } from 'vitest'
import { REVIEW_NOTE_EDITOR_MAX, prepareReviewSubmission } from './reviewSubmission'

describe('review request form validation', () => {
  const eligible = ['first', 'second']
  const prepare = (selected: string[], duration: string, note: string) => prepareReviewSubmission(selected, eligible, duration, note)
  it('retains optional duration and independent multiple-reviewer submission, with no response date', () => {
    expect(prepare(eligible, '', '')).toEqual({ options: { reviewerIds: eligible, reviewDurationDays: undefined, note: undefined } })
    expect(prepare(eligible, '30', 'Review this version')).toEqual({ options: { reviewerIds: eligible, reviewDurationDays: 30, note: 'Review this version' } })
  })

  it.each([[], ['author'], ['coauthor'], ['foreign'], ['first', 'first'], ['first', 'foreign']].map((selected) => ({ selected })))('rejects missing, duplicate or ineligible reviewers: $selected', ({ selected }) => {
    expect(prepare(selected, '', '')).toEqual({ error: 'reviewers' })
  })

  it.each(['0', '3651', '-1', '1.5', 'NaN', 'invalid'])('rejects unsupported duration %s', (days) => {
    expect(prepare(['first'], days, '')).toEqual({ error: 'duration' })
  })

  it('uses the same 500-character limit for the editor and submission validation', () => {
    expect(REVIEW_NOTE_EDITOR_MAX).toBe(500)
    for (const length of [1, 499, 500]) {
      const note = 'x'.repeat(length)
      expect(prepare(['first'], '5', note)).toHaveProperty('options.note', note)
    }
    const tooLong = 'x'.repeat(501)
    expect(prepare(['first'], '5', tooLong)).toEqual({ error: 'note' })
    expect(tooLong).toHaveLength(501)
    // Trim surrounding whitespace without truncating the submitted comment.
    expect(prepare(['first'], '', ` ${'x'.repeat(500)} `)).toHaveProperty('options.note', 'x'.repeat(500))
  })
})
