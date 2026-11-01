import { describe, expect, it } from 'vitest'
import { sopWorkflowEn } from '../content/workflow.en'
import { internalReviewEn } from '../content/internalReview.en'
import { previewReviewDeadline, ReviewDeadlineUnavailableError, reviewDeadlineFailure } from './reviewDeadline'
import { endOfRiyadhDay } from './riyadhWorkingDays'

// Accepted on Thursday 29 October 2026, so working days count from Sunday 1 November.
const request = { acceptedAt: '2026-10-29T09:00:00.000Z', reviewDueDate: '2026-11-05', reviewDueAt: endOfRiyadhDay('2026-11-05') }
const now = new Date('2026-10-30T09:00:00+03:00')

describe('the deadline a number of working days gives', () => {
  it('counts from acceptance, skipping that day and the weekend, to the end of the day in Riyadh', () => {
    expect(previewReviewDeadline(request, '7', now)).toEqual({ dueDate: '2026-11-09', dueAt: endOfRiyadhDay('2026-11-09'), shorter: false, long: false })
  })

  it('never lands on a Friday or Saturday', () => {
    for (let days = 1; days <= 60; days += 1) {
      const weekday = new Date(`${previewReviewDeadline(request, String(days), now).dueDate}T00:00:00Z`).getUTCDay()
      expect(weekday === 5 || weekday === 6).toBe(false)
    }
  })

  it.each(['', '0', '3651', '-1', '1.5', 'abc'])('refuses %s as a number of working days', (duration) => {
    expect(previewReviewDeadline(request, duration, now)).toEqual({ problem: 'invalid', shorter: false, long: false })
  })

  it('refuses the same deadline, and one that has passed, but allows one ending today', () => {
    expect(previewReviewDeadline(request, '5', now).problem).toBe('unchanged')
    const later = new Date('2026-11-03T09:00:00+03:00')
    expect(previewReviewDeadline(request, '1', later).problem).toBe('past')
    expect(previewReviewDeadline(request, '2', later).problem).toBe('past')
    expect(previewReviewDeadline(request, '3', later).problem).toBeUndefined()
  })

  it('flags an earlier deadline and a long duration for confirmation', () => {
    expect(previewReviewDeadline(request, '4', now).shorter).toBe(true)
    expect(previewReviewDeadline(request, '6', now).shorter).toBe(false)
    expect(previewReviewDeadline(request, '60', now).long).toBe(false)
    expect(previewReviewDeadline(request, '61', now).long).toBe(true)
  })

  it('has no old deadline to compare with on a request accepted without one', () => {
    expect(previewReviewDeadline({ acceptedAt: request.acceptedAt }, '5', now)).toMatchObject({ dueDate: '2026-11-05', shorter: false })
  })
})

describe('the messages', () => {
  it('explains a stale request, and keeps the general message otherwise', () => {
    const text = internalReviewEn.panel.deadline
    expect(text[reviewDeadlineFailure(new ReviewDeadlineUnavailableError('Finished'))]).toBe(text.unavailable)
    expect(text[reviewDeadlineFailure(new Error('Connection lost'))]).toBe(text.failed)
  })

  it('has the timeline wording', () => {
    expect(sopWorkflowEn.timeline.deadlineChange).toContain('{old}')
    expect(sopWorkflowEn.timeline.deadlineChange).toContain('{new}')
  })
})
