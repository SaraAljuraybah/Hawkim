import { describe, expect, it } from 'vitest'
import { internalReviewEn } from '../content/internalReview.en'
import { lockedFieldClass, refusesChoice, reviewDepartmentLock } from './reviewDepartment'

describe('the Submit for Review department lock', () => {
  it('keeps the SOP\'s first review and a new version\'s first send in its department, as submit_for_review does', () => {
    for (const homeFinished of [false, true]) {
      expect(reviewDepartmentLock('submit', homeFinished)).toBe('first-review')
      expect(reviewDepartmentLock('version', homeFinished)).toBe('first-send')
    }
  })

  it('keeps Add Reviewers in its department until a reviewer from it has finished, as add_reviewers does', () => {
    expect(reviewDepartmentLock('add', false)).toBe('home-must-finish')
    expect(reviewDepartmentLock('add', true)).toBeUndefined()
  })

  it('refuses another choice while locked, but not the SOP\'s own or the empty value typing gives', () => {
    expect(refusesChoice(true, 'home', 'other')).toBe(true)
    expect(refusesChoice(true, 'home', 'home')).toBe(false)
    expect(refusesChoice(true, 'home', '')).toBe(false)
    expect(refusesChoice(false, 'home', 'other')).toBe(false)
  })

  it('styles a locked field like the read-only Department on Add SOP, keeping the error border', () => {
    expect(lockedFieldClass(true, false)).toBe('[&_input]:border-beige [&_input]:bg-beige/50')
    expect(lockedFieldClass(true, true)).toBe('[&_input]:bg-beige/50')
    expect(lockedFieldClass(false, false)).toBeUndefined()
    expect(lockedFieldClass(false, true)).toBeUndefined()
  })

  it('names the SOP\'s department in each message', () => {
    expect(internalReviewEn.submit.firstReviewHome.replace('{department}', 'Pharmacovigilance'))
      .toBe('The first review must be completed within the Pharmacovigilance department.')
    expect(internalReviewEn.submit.firstSendHome.replace('{department}', 'Pharmacovigilance'))
      .toBe('The first reviewers for this version must be from Pharmacovigilance.')
    expect(internalReviewEn.submit.homeFirst.replace('{department}', 'Pharmacovigilance'))
      .toBe('Reviewers from other departments can be added once a reviewer from Pharmacovigilance has finished this version.')
  })
})
