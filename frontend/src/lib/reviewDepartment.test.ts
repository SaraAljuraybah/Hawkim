import { describe, expect, it } from 'vitest'
import { internalReviewEn } from '../content/internalReview.en'
import { refusesChoice, reviewDepartmentLock } from './reviewDepartment'

describe('the Submit for Review department lock', () => {
  it('keeps the SOP\'s first review and a new version\'s first send in its department, as submit_for_review does', () => {
    expect(reviewDepartmentLock('submit')).toBe('first-review')
    expect(reviewDepartmentLock('version')).toBe('first-send')
    // add_reviewers checks other departments against has_home_finished instead.
    expect(reviewDepartmentLock('add')).toBeUndefined()
  })

  it('refuses another choice while locked, but not the SOP\'s own or the empty value typing gives', () => {
    expect(refusesChoice(true, 'home', 'other')).toBe(true)
    expect(refusesChoice(true, 'home', 'home')).toBe(false)
    expect(refusesChoice(true, 'home', '')).toBe(false)
    expect(refusesChoice(false, 'home', 'other')).toBe(false)
  })

  it('names the SOP\'s department in each message', () => {
    expect(internalReviewEn.submit.firstReviewHome.replace('{department}', 'Pharmacovigilance'))
      .toBe('The first review must be completed within the Pharmacovigilance department.')
    expect(internalReviewEn.submit.firstSendHome.replace('{department}', 'Pharmacovigilance'))
      .toBe('The first reviewers for this version must be from Pharmacovigilance.')
  })
})
