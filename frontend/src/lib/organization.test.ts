import { describe, expect, it } from 'vitest'
import type { Permission } from '../data/mock/types'
import { filterPeople, matchesName, matchesRoles, OTHERS_FILTER, roleFilters } from './organization'

const person = (name: string, permissions: Permission[] = []) => ({ name, permissions })
const author = person('Sara Ahmed', ['author'])
const both = person('Noura Alqahtani', ['author', 'reviewer'])
const reviewer = person('Huda Alotaibi', ['reviewer'])
const approver = person('Reem Saleh', ['approver'])
const none = person('Lama Fahad')
const people = [author, both, reviewer, approver, none]

describe('name search', () => {
  it('matches part of the name, ignoring case and surrounding spaces', () => {
    expect(matchesName(author, 'sara')).toBe(true)
    expect(matchesName(author, '  AHMED  ')).toBe(true)
    expect(matchesName(author, 'noura')).toBe(false)
  })
  it('matches everyone when the search is empty or only spaces', () => {
    expect(filterPeople(people, '', [])).toEqual(people)
    expect(filterPeople(people, '   ', [])).toEqual(people)
  })
  it('searches the name only', () => {
    expect(filterPeople(people, 'author', [])).toEqual([])
  })
})

describe('role filter', () => {
  it('shows a person with ANY of the selected roles, so two roles match either one', () => {
    expect(filterPeople(people, '', ['author'])).toEqual([author, both])
    expect(filterPeople(people, '', ['reviewer'])).toEqual([both, reviewer])
    expect(filterPeople(people, '', ['author', 'reviewer'])).toEqual([author, both, reviewer])
  })
  it('"Others" means no Author, Reviewer or Approver role', () => {
    expect(filterPeople(people, '', [OTHERS_FILTER])).toEqual([none])
    expect(filterPeople(people, '', ['approver', OTHERS_FILTER])).toEqual([approver, none])
    expect(matchesRoles(approver, [OTHERS_FILTER])).toBe(false)
  })
  it('shows everyone when nothing is selected', () => {
    expect(filterPeople(people, '', [])).toEqual(people)
  })
  it('combines with the search: a person must match both', () => {
    expect(filterPeople(people, 'noura', ['author'])).toEqual([both])
    expect(filterPeople(people, 'sara', ['reviewer'])).toEqual([])
  })
})

describe('role filter options', () => {
  it('offers Approver only in the Quality department', () => {
    expect(roleFilters(true)).toEqual(['author', 'reviewer', 'approver', OTHERS_FILTER])
    expect(roleFilters(false)).toEqual(['author', 'reviewer', OTHERS_FILTER])
  })
})
