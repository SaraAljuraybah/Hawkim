import { describe, expect, it } from 'vitest'
import { sopWorkflowEn } from '../content/workflow.en'
import { internalReviewEn } from '../content/internalReview.en'
import { fixedResponseDueDate, RESPONSE_WORKING_DAYS } from './fixedResponseDeadline'
import { latestReviewDueDate, previewReviewDeadline, ReviewDeadlineUnavailableError, reviewDeadlineFailure } from './reviewDeadline'
import { formatDateWithWeekday } from './format'
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

describe('the Submit for Review latest due date', () => {
  // Sent Tuesday 3 November 2026, 10 PM in Riyadh (still Tuesday there, already Wednesday in UTC+4 and beyond):
  // the reviewer can accept until the end of Thursday 5 November, two working days later.
  const tuesday = new Date('2026-11-03T22:00:00+03:00')

  it('adds the duration to the last day to accept, in working days, skipping Friday and Saturday', () => {
    expect(fixedResponseDueDate(tuesday)).toBe('2026-11-05')
    expect(latestReviewDueDate('2', tuesday)).toBe('2026-11-09')
    expect(latestReviewDueDate('3', tuesday)).toBe('2026-11-10')
    expect(latestReviewDueDate(' 5 ', tuesday)).toBe('2026-11-12')
    // Sent on a Thursday: the last day to accept is Monday, and one working day later is Tuesday.
    expect(latestReviewDueDate('1', new Date('2026-11-05T09:00:00+03:00'))).toBe('2026-11-10')
  })

  it('matches what acceptance on the last day saves', () => {
    for (const sent of [tuesday, new Date('2026-11-05T09:00:00+03:00'), new Date('2026-11-06T12:00:00+03:00')]) {
      const lastDay = { acceptedAt: endOfRiyadhDay(fixedResponseDueDate(sent)) }
      for (const days of ['1', '4', '60', '3650']) {
        expect(latestReviewDueDate(days, sent)).toBe(previewReviewDeadline(lastDay, days, sent).dueDate)
      }
    }
  })

  it('counts calendar days after the last day to accept with the working-day policy off', () => {
    expect(latestReviewDueDate('3', tuesday, false)).toBe('2026-11-08')
  })

  it('gives nothing while the duration is blank or invalid', () => {
    for (const duration of ['', '  ', '0', '3651', '2.5', '-1', '1e2', 'abc']) expect(latestReviewDueDate(duration, tuesday)).toBeUndefined()
  })

  it('reads with its weekday', () => {
    expect(internalReviewEn.submit.durationDueDate.replace('{date}', formatDateWithWeekday('2026-11-09')))
      .toBe('Latest due date: Mon, Nov 9, 2026 (if the reviewer accepts on the last day).')
    expect(internalReviewEn.submit.durationHelp.replace('{count}', String(RESPONSE_WORKING_DAYS)))
      .toBe('The reviewer has 2 working days to accept. The review time starts when they accept (weekends excluded).')
  })
})
