import { describe, expect, it } from 'vitest'
import { SOP_DESCRIPTION_MAX } from './sopDescription'
import { SOP_TITLE_MAX, sopTitleProblem } from './sopTitle'
import { uploadSopEn } from '../content/mySops.en'
import { sopWorkflowEn } from '../content/workflow.en'

// Add SOP and Edit SOP Details share these limits; the database allows the same (sops.title 1 to 150 trimmed
// characters, checked again by create_sop and update_sop_details; sops.description up to 1000).
describe('SOP title and description limits', () => {
  it('allows titles of 1 to 150 characters', () => {
    expect(SOP_TITLE_MAX).toBe(150)
    expect(sopTitleProblem('x')).toBeUndefined()
    expect(sopTitleProblem('x'.repeat(149))).toBeUndefined()
    expect(sopTitleProblem('x'.repeat(150))).toBeUndefined()
    expect(sopTitleProblem('x'.repeat(151))).toBe('too-long')
  })
  it('still requires a title', () => {
    expect(sopTitleProblem('')).toBe('required')
    expect(sopTitleProblem(' \t\n ')).toBe('required')
  })
  it('keeps the description at 1000 characters', () => {
    expect(SOP_DESCRIPTION_MAX).toBe(1000)
  })
  it('says the same limit in the hint and the error on Add SOP and Edit SOP Details', () => {
    expect(uploadSopEn.fields.title.hint).toBe('Up to 150 characters.')
    expect(uploadSopEn.errors.titleTooLong).toBe('Enter a title of up to 150 characters.')
    expect(sopWorkflowEn.details.dialog.titleHint).toBe(uploadSopEn.fields.title.hint)
    expect(sopWorkflowEn.details.dialog.errors.titleTooLong).toBe(uploadSopEn.errors.titleTooLong)
  })
})
