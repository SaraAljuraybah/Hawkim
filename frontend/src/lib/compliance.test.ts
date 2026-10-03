import { describe, expect, it } from 'vitest'
import type { ComplianceCheck, ComplianceResult, Sop } from '../data/mock/types'
import {
  compareReports,
  complianceScore,
  numberedFindings,
  previousReport,
  reportId,
  startCheck,
  verdictOf,
} from './compliance'

/** A completed check whose findings have these results, for requirements R1, R2… in order. */
function check(results: ComplianceResult[], { id = 'chk', version = '1.0' } = {}): ComplianceCheck {
  return {
    id,
    sopId: 'sop-1',
    version,
    status: 'completed',
    startedAt: '2026-01-01T09:00:00Z',
    completedAt: '2026-01-01T09:00:03Z',
    guideline: { name: 'GVP', version: '1' },
    findings: results.map((result, index) => ({
      id: `${id}-f${index + 1}`,
      requirementId: `R${index + 1}`,
      result,
      justification: '',
    })),
  }
}

/** A minimal SOP with these compliance checks. */
function sopWith(complianceChecks: ComplianceCheck[], version = '1.0'): Sop {
  return {
    id: 'sop-1',
    code: 'SOP-001',
    title: 'Test SOP',
    departmentId: 'information-technology',
    version,
    status: 'draft',
    lastUpdated: '2026-01-01',
    authorId: 'sara',
    coAuthorIds: [],
    fileName: 'SOP-001.pdf',
    fileType: 'pdf',
    reviewers: [],
    approvers: [],
    versions: [],
    comments: [],
    timeline: [],
    complianceChecks,
  }
}

describe('complianceScore (strict: only Compliant counts)', () => {
  it('is the share of compliant requirements, as a whole percentage', () => {
    expect(complianceScore(check(['compliant', 'compliant', 'partial', 'conflict', 'not-addressed']))).toBe(40)
  })

  it('gives no credit for partially compliant requirements', () => {
    expect(complianceScore(check(['partial', 'partial']))).toBe(0)
  })

  it('rounds to a whole number', () => {
    expect(complianceScore(check(['compliant', 'partial', 'partial']))).toBe(33)
    expect(complianceScore(check(['compliant', 'compliant', 'partial']))).toBe(67)
  })

  it('is 100 when everything is compliant, and 0 without findings', () => {
    expect(complianceScore(check(['compliant', 'compliant']))).toBe(100)
    expect(complianceScore(check([]))).toBe(0)
  })
})

describe('verdictOf', () => {
  it('is Fully compliant when every requirement is compliant', () => {
    expect(verdictOf(check(['compliant', 'compliant']))).toBe('fully-compliant')
  })

  it('is Needs improvement for anything partial or not addressed, without conflicts', () => {
    expect(verdictOf(check(['compliant', 'partial']))).toBe('needs-improvement')
    expect(verdictOf(check(['compliant', 'not-addressed']))).toBe('needs-improvement')
  })

  it('is Action required as soon as there is one conflict, whatever the score', () => {
    expect(verdictOf(check(['compliant', 'compliant', 'compliant', 'compliant', 'conflict']))).toBe('action-required')
  })
})

describe('numberedFindings', () => {
  it('orders findings Conflict, Not addressed, Partially compliant, Compliant and numbers them F-01, F-02…', () => {
    const numbered = numberedFindings(check(['compliant', 'partial', 'conflict', 'not-addressed', 'compliant']))
    expect(numbered.map((finding) => `${finding.number} ${finding.result} ${finding.requirementId}`)).toEqual([
      'F-01 conflict R3',
      'F-02 not-addressed R4',
      'F-03 partial R2',
      'F-04 compliant R1',
      'F-05 compliant R5',
    ])
  })
})

describe('reportId', () => {
  it('is CR-{code}-{version}-{run}, counting every run of that version (failed ones too)', () => {
    const failed: ComplianceCheck = { ...check([], { id: 'a', version: '1.1' }), status: 'failed' }
    const second = check(['compliant'], { id: 'b', version: '1.1' })
    const sop = sopWith([check(['compliant'], { id: 'old', version: '1.0' }), failed, second], '1.1')
    expect(reportId(sop, second)).toBe('CR-SOP-001-1.1-02')
  })
})

describe('previousReport', () => {
  it('is the newest completed report of the nearest earlier version', () => {
    const v10 = check(['conflict'], { id: 'v10', version: '1.0' })
    const v11first = check(['conflict'], { id: 'v11a', version: '1.1' })
    const v11second = check(['partial'], { id: 'v11b', version: '1.1' })
    const v12 = check(['compliant'], { id: 'v12', version: '1.2' })
    const sop = sopWith([v10, v11first, v11second, v12], '1.2')
    expect(previousReport(sop, v12)?.id).toBe('v11b')
    expect(previousReport(sop, v10)).toBeUndefined()
  })
})

describe('compareReports', () => {
  it('describes each requirement as resolved, improved, unchanged or worsened', () => {
    const before = check(['partial', 'conflict', 'compliant', 'partial'])
    const after = check(['compliant', 'partial', 'compliant', 'not-addressed'])
    expect(compareReports(before, after).map((change) => `${change.requirementId} ${change.kind}`)).toEqual([
      'R1 resolved', // partial → compliant
      'R2 improved', // conflict → partial
      'R3 unchanged', // compliant → compliant
      'R4 worsened', // partial → not addressed
    ])
  })

  it('marks requirements found in only one of the reports as new or removed', () => {
    expect(compareReports(check(['compliant']), check(['compliant', 'partial'])).map((change) => change.kind)).toEqual([
      'unchanged',
      'new',
    ])
    expect(compareReports(check(['compliant', 'partial']), check(['compliant'])).map((change) => change.kind)).toEqual([
      'unchanged',
      'removed',
    ])
  })
})

describe('startCheck', () => {
  it('refuses a manual run while a check is running, but an upload replaces the running check', () => {
    const running = startCheck(sopWith([])).sop
    expect(() => startCheck(running)).toThrow()
    const replaced = startCheck(running, { afterUpload: true }).sop
    expect(replaced.complianceChecks.filter((item) => item.status === 'running')).toHaveLength(1)
  })
})
