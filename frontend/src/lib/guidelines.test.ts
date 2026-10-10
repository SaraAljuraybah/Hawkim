import { describe, expect, it } from 'vitest'
import type { ComplianceCheck, GuidelineVersion, Sop } from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { completeCheck, hasCurrentCheck, latestCompletedChecksByVersion, startCheck } from './compliance'
import {
  compareVersions,
  newGuidelineVersion,
  recheckRecommended,
  validateGuidelineVersion,
  type GuidelineVersionInput,
} from './guidelines'
import { completeReview, resubmit, returnAsReviewer, submitForReview, uploadVersion } from './workflow'

/** GVP 4.0, with one requirement. */
const v40: GuidelineVersion = {
  id: 'gvp-4-0',
  version: '4.0',
  effectiveDate: '2015-09-01',
  fileName: 'Drug-GVP4_0.pdf',
  requirements: [
    { id: 'R1', module: 'Module I', section: 'I.B.10', sectionTitle: 'Record management', shortTitle: 'Access', page: 22, summary: '' },
  ],
}
const gvp = (version: string) => ({ name: 'GVP', version })

/** A completed check of SOP version `sopVersion` against GVP `guidelineVersion`. */
function check(sopVersion: string, guidelineVersion: string, status: ComplianceCheck['status'] = 'completed'): ComplianceCheck {
  return {
    id: `chk-${sopVersion}-${guidelineVersion}-${status}`,
    sopId: 'sop-1',
    version: sopVersion,
    status,
    startedAt: '2026-01-01T09:00:00Z',
    guideline: gvp(guidelineVersion),
    findings: status === 'completed' ? [{ id: 'f1', requirementId: 'R1', result: 'compliant', justification: '' }] : [],
  }
}

/** Sara's SOP v1.0 with this status and these checks. */
function sop(status: SopStatus, complianceChecks: ComplianceCheck[]): Sop {
  return {
    id: 'sop-1',
    code: 'SOP-001',
    title: 'Test SOP',
    departmentId: 'it',
    version: '1',
    status,
    lastUpdated: '2026-01-01',
    authorId: 'sara',
    coAuthorIds: [],
    fileName: 'SOP-001.pdf',
    fileType: 'pdf',
    reviewers: [],
    approvers: [],
    versions: [{ version: '1', fileName: 'SOP-001.pdf', fileType: 'pdf', uploadedAt: '2026-01-01T08:00:00Z' }],
    comments: [],
    timeline: [],
    complianceChecks,
  }
}

const input = (overrides: Partial<GuidelineVersionInput> = {}): GuidelineVersionInput => ({
  version: '4.1',
  issuedDate: '',
  effectiveDate: '2026-11-01',
  fileName: 'Drug-GVP4_1.pdf',
  summary: '',
  ...overrides,
})

describe('version numbers', () => {
  it('compares each part as a number', () => {
    expect(compareVersions('4.10', '4.9')).toBeGreaterThan(0)
    expect(compareVersions('5.0', '4.10')).toBeGreaterThan(0)
    expect(compareVersions('4.0', '4.0')).toBe(0)
    expect(compareVersions('4.1', '4.2')).toBeLessThan(0)
  })

  it('needs digits, a dot and digits', () => {
    for (const version of ['', '5', '4.', '.1', 'v4.1', '4.1.2', '4,1', 'four']) {
      expect(validateGuidelineVersion(input({ version }), v40).version, version).toBe('version-invalid')
    }
    expect(validateGuidelineVersion(input({ version: ' 4.1 ' }), v40).version).toBeUndefined()
  })

  it('must be higher than the current version', () => {
    expect(validateGuidelineVersion(input({ version: '4.0' }), v40).version).toBe('version-not-higher')
    expect(validateGuidelineVersion(input({ version: '3.9' }), v40).version).toBe('version-not-higher')
    expect(validateGuidelineVersion(input({ version: '4.10' }), { ...v40, version: '4.9' }).version).toBeUndefined()
  })
})

describe('the other fields', () => {
  it('requires an effective date and a PDF file', () => {
    const problems = validateGuidelineVersion(input({ effectiveDate: '', fileName: '' }), v40)
    expect(problems.effectiveDate).toBe('effective-required')
    expect(problems.fileName).toBe('file-required')
    expect(validateGuidelineVersion(input({ fileName: 'GVP.docx' }), v40).fileName).toBe('file-not-pdf')
    expect(validateGuidelineVersion(input({ fileName: 'GVP.PDF' }), v40).fileName).toBeUndefined()
  })

  it('allows an issued date on or before the effective date, and a future effective date', () => {
    expect(validateGuidelineVersion(input({ issuedDate: '2026-11-02' }), v40).issuedDate).toBe('issued-after-effective')
    expect(validateGuidelineVersion(input({ issuedDate: '2026-11-01' }), v40).issuedDate).toBeUndefined()
    expect(validateGuidelineVersion(input({ effectiveDate: '2099-01-01' }), v40)).toEqual({})
  })

  it('allows a summary of up to 500 characters', () => {
    expect(validateGuidelineVersion(input({ summary: 'x'.repeat(500) }), v40).summary).toBeUndefined()
    expect(validateGuidelineVersion(input({ summary: 'x'.repeat(501) }), v40).summary).toBe('summary-too-long')
  })

  it('copies the previous version’s requirements into the new version and records who added it', () => {
    const added = newGuidelineVersion(input({ summary: '  New module.  ' }), v40, 'nouf', '2026-10-04T10:00:00Z')
    expect(added).toMatchObject({ id: 'gvp-4-1', version: '4.1', summary: 'New module.', addedById: 'nouf' })
    expect(added.issuedDate).toBeUndefined()
    expect(added.requirements).toEqual(v40.requirements)
    expect(added.requirements[0]).not.toBe(v40.requirements[0])
  })
})

describe('recheckRecommended', () => {
  it('flags drafts, returned and published SOPs last checked against an older version', () => {
    for (const status of ['draft', 'returned', 'published'] as const) {
      expect(recheckRecommended(sop(status, [check('1', '4.0')]), '4.1'), status).toBe(true)
    }
  })

  it('doesn’t flag SOPs in the workflow, where the author can’t run a check', () => {
    for (const status of ['in-review', 'in-approval', 'approved'] as const) {
      expect(recheckRecommended(sop(status, [check('1', '4.0')]), '4.1'), status).toBe(false)
    }
  })

  it('uses the newest completed check: a recheck clears the flag; running or failed checks don’t count', () => {
    expect(recheckRecommended(sop('published', [check('1', '4.0'), check('1', '4.1')]), '4.1')).toBe(false)
    expect(recheckRecommended(sop('published', [check('1', '4.0'), check('1', '4.1', 'failed')]), '4.1')).toBe(true)
    expect(recheckRecommended(sop('published', [check('1', '4.0'), check('1', '4.1', 'running')]), '4.1')).toBe(true)
  })

  it('doesn’t flag an SOP never checked, or when no newer version exists', () => {
    expect(recheckRecommended(sop('draft', []), '4.1')).toBe(false)
    expect(recheckRecommended(sop('published', [check('1', '4.0')]), '4.0')).toBe(false)
  })
})

describe('submitting needs a check against the current version', () => {
  it('refuses Submit with only a check against an older version, and allows it after a recheck', () => {
    const draft = sop('draft', [check('1', '4.0')])
    expect(hasCurrentCheck(draft, '4.1')).toBe(false)
    expect(() => submitForReview(draft, 'sara', '4.1', ['noura'], ['huda'], undefined, undefined)).toThrow(/current guideline/)
    const rechecked = sop('draft', [check('1', '4.0'), check('1', '4.1')])
    expect(submitForReview(rechecked, 'sara', '4.1', ['noura'], ['huda'], undefined, undefined).status).toBe('in-review')
  })

  it('refuses Resubmit with only a check against an older version', () => {
    const submitted = submitForReview(sop('draft', [check('1', '4.0')]), 'sara', '4.0', ['noura'], ['huda'], undefined, undefined)
    const returned = returnAsReviewer(submitted, 'noura', 'Fix it.')
    const updated = uploadVersion(returned, 'sara', { fileName: 'v2.pdf', fileType: 'pdf' })
    const checkedOld = { ...updated, complianceChecks: [...updated.complianceChecks, check('2', '4.0')] }
    expect(() => resubmit(checkedOld, 'sara', '4.1')).toThrow(/current guideline/)
    const checkedNew = { ...updated, complianceChecks: [...updated.complianceChecks, check('2', '4.1')] }
    expect(resubmit(checkedNew, 'sara', '4.1').status).toBe('in-review')
    expect(completeReview(resubmit(checkedNew, 'sara', '4.1'), 'noura').status).toBe('in-approval')
  })
})

describe('reports keep their version', () => {
  it('records the current version on a new check and leaves earlier reports unchanged', () => {
    const before = sop('published', [check('1', '4.0')])
    const started = startCheck(before, gvp('4.1'))
    const after = completeCheck(started.sop, started.checkId)
    expect(latestCompletedChecksByVersion(after).length).toBe(1) // the newest report of SOP v1
    expect(after.complianceChecks.map((item) => item.guideline.version)).toEqual(['4.0', '4.1'])
    expect(after.complianceChecks[0]).toEqual(before.complianceChecks[0])
  })
})
