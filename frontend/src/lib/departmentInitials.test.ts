import { describe, expect, it } from 'vitest'
import { departmentAbbreviation, storedDepartmentInitials } from './departmentInitials'

describe('the department badge abbreviation', () => {
  it.each([
    ['Clinical Operations', 'CO'],
    ['Research & Development', 'RD'],
    ['Quality Assurance', 'QA'],
    ['Human Resources Management', 'HR'],
    ['Regulatory Affairs', 'RA'],
  ])('uses the first letters of the first two meaningful words: %s → %s', (name, abbreviation) => {
    expect(departmentAbbreviation(name)).toBe(abbreviation)
  })

  it('ignores punctuation, symbols and connector words, and is uppercase', () => {
    expect(departmentAbbreviation('  research,   & development!')).toBe('RD')
    expect(departmentAbbreviation('Department of Health')).toBe('DH')
    expect(departmentAbbreviation('R&D')).toBe('RD')
    expect(departmentAbbreviation('Quality-Assurance (QA)')).toBe('QA')
  })

  it('uses the first two letters of a one-word name', () => {
    expect(departmentAbbreviation('Finance')).toBe('FI')
    expect(departmentAbbreviation('Pharmacovigilance')).toBe('PH')
    expect(departmentAbbreviation('X')).toBe('X')
  })

  it('follows the name when it changes', () => {
    expect(departmentAbbreviation('Quality Assurance')).not.toBe(departmentAbbreviation('Regulatory Affairs'))
  })

  it('handles names in other scripts and empty names', () => {
    expect(departmentAbbreviation('الجودة والامتثال')).toBe('او')
    expect(departmentAbbreviation('   ')).toBe('')
  })
})

describe('the initials stored for the database', () => {
  const departments = [
    { id: 'qa', name: 'Quality Assurance', initials: 'QA' },
    { id: 'qc', name: 'Quality Control', initials: 'QC' },
  ]

  it('are the abbreviation when it is free', () => {
    expect(storedDepartmentInitials('Regulatory Affairs', departments)).toBe('RA')
  })

  it('never take another department’s initials: a 3-letter variant instead', () => {
    expect(storedDepartmentInitials('Quality Audit', departments)).toBe('QAU')
    expect(storedDepartmentInitials('Quality Audit Team', departments)).toBe('QAT')
    expect(storedDepartmentInitials('quality audit', [...departments, { id: 'x', name: 'Other', initials: 'qau' }])).toBe('QAD')
  })

  it('always fit the database rule (2–3 Latin letters), even without Latin letters in the name', () => {
    for (const name of ['الجودة', 'Café Équipe', 'X', '1 2 3', 'Finance']) expect(storedDepartmentInitials(name, departments)).toMatch(/^[A-Z]{2,3}$/)
    expect(storedDepartmentInitials('Café Équipe', departments)).toBe('CE')
  })

  it('keep an edited department’s current initials while the name is unchanged', () => {
    expect(storedDepartmentInitials('Quality Control', departments, departments[1])).toBe('QC')
    expect(storedDepartmentInitials('Quality Assurance', departments, { id: 'qa', name: 'Quality Assurance', initials: 'QAS' })).toBe('QAS')
  })

  it('are regenerated when the name changes, ignoring the department’s own old value', () => {
    expect(storedDepartmentInitials('Clinical Operations', departments, departments[1])).toBe('CO')
    expect(storedDepartmentInitials('Quality Assurance', departments, { id: 'qc', name: 'Quality Control', initials: 'QC' })).toBe('QAS')
  })
})

describe('the agreed examples (Divisions & Departments dialogs)', () => {
  it.each([
    ['Clinical Operations', 'CO'],
    ['Research & Development', 'RD'],
    ['Finance', 'FI'],
    ['Sales and Marketing', 'SM'],
    ['Department of Health', 'DH'],
    ['Quality & Compliance', 'QC'],
    ['Human Resources Management', 'HR'],
  ])('%s → badge %s, and the same value is saved when it is free', (name, initials) => {
    expect(departmentAbbreviation(name)).toBe(initials)
    expect(storedDepartmentInitials(name, [])).toBe(initials)
  })

  it('saves the first free 3-letter variant when another department uses the abbreviation, while the badge stays QA', () => {
    const others = [{ id: 'qa', name: 'Quality Assurance', initials: 'QA' }]
    expect(departmentAbbreviation('Quality Audit')).toBe('QA')
    expect(storedDepartmentInitials('Quality Audit', others)).toBe('QAU')
  })
})
