import { describe, expect, it } from 'vitest'
import { complianceEn } from '../../content/compliance.en'
import type { ComplianceCheck, ComplianceResult } from '../../data/mock/types'
import { summarySentence } from './summarySentence'

const text = complianceEn.report.summary

function check(results: ComplianceResult[]): ComplianceCheck {
  return {
    id: 'chk',
    sopId: 'sop-1',
    version: '1',
    status: 'completed',
    startedAt: '2026-01-01T09:00:00Z',
    completedAt: '2026-01-01T09:00:03Z',
    guideline: { name: 'GVP', version: '1' },
    findings: results.map((result, index) => ({ id: `f${index + 1}`, requirementId: `R${index + 1}`, result, justification: '' })),
  }
}

describe('summarySentence', () => {
  it('says that requirements need human review, in the singular and the plural', () => {
    expect(summarySentence(check(['not-addressed', 'compliant']), 'in-review', text)).toBe('1 requirement needs human review.')
    expect(summarySentence(check(['not-addressed', 'not-addressed']), 'in-review', text)).toBe('2 requirements need human review.')
  })

  it('keeps human review out of the "need attention" sentence', () => {
    expect(summarySentence(check(['conflict', 'partial', 'not-addressed', 'not-addressed']), 'in-review', text)).toBe(
      '1 conflict and 1 partially compliant requirement need attention. 2 requirements need human review.',
    )
  })

  it('mentions submitting for review only while the author can still submit', () => {
    expect(summarySentence(check(['conflict', 'not-addressed']), 'draft', text)).toBe(
      '1 conflict needs attention before submitting for review. 1 requirement needs human review.',
    )
    expect(summarySentence(check(['partial', 'partial']), 'returned', text)).toBe(
      '2 partially compliant requirements need attention before submitting for review.',
    )
  })

  it('says everything is compliant when nothing needs attention', () => {
    expect(summarySentence(check(['compliant']), 'in-review', text)).toBe(text.allCompliant)
  })
})
