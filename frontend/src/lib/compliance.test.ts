import { describe, expect, it } from 'vitest'
import type { ComplianceCheck, ComplianceResult, Sop } from '../data/mock/types'
import {
  compareReports,
  completeCheck,
  latestCompletedChecksByVersion,
  complianceScore,
  failCheck,
  numberedFindings,
  previousReport,
  reportId,
  startCheck,
  verdictOf,
} from './compliance'
import { uploadVersion } from './workflow'

/** A completed check whose findings have these results, for requirements R1, R2… in order. */
function check(results: ComplianceResult[], { id = 'chk', version = '1' } = {}): ComplianceCheck {
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
function sopWith(complianceChecks: ComplianceCheck[], version = '1'): Sop {
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
    const failed: ComplianceCheck = { ...check([], { id: 'a', version: '2' }), status: 'failed' }
    const second = check(['compliant'], { id: 'b', version: '2' })
    const sop = sopWith([check(['compliant'], { id: 'old', version: '1' }), failed, second], '2')
    expect(reportId(sop, second)).toBe('CR-SOP-001-v2-02')
  })
})

describe('latestCompletedChecksByVersion', () => {
  it('lists the newest report per version, newest version first, without deleted versions', () => {
    const v1 = check(['conflict'], { id: 'v1', version: '1' })
    const v2 = check(['partial'], { id: 'v2', version: '2' })
    const v3 = check(['compliant'], { id: 'v3', version: '3' })
    const sop = sopWith([v1, v2, v3], '3')
    expect(latestCompletedChecksByVersion(sop).map((item) => item.id)).toEqual(['v3', 'v2', 'v1'])
    const at = '2026-01-02T00:00:00Z'
    const withDeleted: Sop = {
      ...sop,
      versions: ['1', '2', '3'].map((version) => ({
        version,
        fileName: 'f.pdf',
        fileType: 'pdf',
        uploadedAt: at,
        ...(version === '2' ? { deletedAt: at, deletedById: 'sara' } : {}),
      })),
    }
    expect(latestCompletedChecksByVersion(withDeleted).map((item) => item.id)).toEqual(['v3', 'v1'])
    expect(previousReport(withDeleted, v3)?.id).toBe('v1')
  })
})

describe('previousReport', () => {
  it('is the newest completed report of the nearest earlier version', () => {
    const v10 = check(['conflict'], { id: 'v10', version: '1' })
    const v11first = check(['conflict'], { id: 'v11a', version: '2' })
    const v11second = check(['partial'], { id: 'v11b', version: '2' })
    const v12 = check(['compliant'], { id: 'v12', version: '3' })
    const sop = sopWith([v10, v11first, v11second, v12], '3')
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
  it('refuses a run while a check is running', () => {
    const guideline = { name: 'GVP', version: '4.0' }
    const running = startCheck(sopWith([]), guideline, { manualBy: 'sara' }).sop
    expect(() => startCheck(running, guideline, { manualBy: 'sara' })).toThrow(/already running/)
    expect(running.complianceChecks.filter((item) => item.status === 'running')).toHaveLength(1)
  })

  it('records who pressed Check, for completed and failed runs', () => {
    const guideline = { name: 'GVP', version: '4.0' }
    const sop: Sop = { ...sopWith([]), coAuthorIds: ['reem'] }
    // Co-author Reem uploads a version and runs the check herself: that run is hers.
    const uploaded = uploadVersion(sop, 'reem', { fileName: 'v2.pdf', fileType: 'pdf' })
    const reemRun = startCheck(uploaded, guideline, { manualBy: 'reem' })
    expect(reemRun.sop.complianceChecks.at(-1)?.triggeredById).toBe('reem')
    expect(completeCheck(reemRun.sop, reemRun.checkId).timeline.at(-1)).toMatchObject({ type: 'compliance-check-completed', actorId: 'reem', version: uploaded.version })
    // Sara presses Check on the same version: that run is hers, failed ones too.
    const done = completeCheck(reemRun.sop, reemRun.checkId)
    const manual = startCheck(done, guideline, { manualBy: 'sara' })
    expect(manual.sop.complianceChecks.at(-1)?.triggeredById).toBe('sara')
    expect(failCheck(manual.sop, manual.checkId).timeline.at(-1)).toMatchObject({ type: 'compliance-check-failed', actorId: 'sara' })
  })
})
