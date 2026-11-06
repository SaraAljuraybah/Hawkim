import { describe, expect, it } from 'vitest'
import type { ComplianceCheck, GuidelineVersion, Sop } from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { completeCheck, hasCurrentCheck, latestCompletedChecksByVersion, startCheck } from './compliance'
import {
  compareVersions,
  currentVersion,
  deleteVersionBlocker,
  editedGuidelineVersion,
  isHttpsLink,
  isSfdaLink,
  newGuidelineVersion,
  recheckRecommended,
  validateGuidelineEdit,
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
  title: 'SFDA GVP Guideline',
  version: '4.1',
  issuedDate: '',
  addedDate: '2026-11-06',
  fileName: 'Drug-GVP4_1.pdf',
  source: 'https://www.sfda.gov.sa/en/regulations/gvp',
  ...overrides,
})
const versions = [v40]
const validate = (overrides: Partial<GuidelineVersionInput> = {}, list: GuidelineVersion[] = versions) => validateGuidelineVersion(input(overrides), list)

describe('version numbers', () => {
  it('compares each part as a number', () => {
    expect(compareVersions('4.10', '4.9')).toBeGreaterThan(0)
    expect(compareVersions('5.0', '4.10')).toBeGreaterThan(0)
    expect(compareVersions('4.0', '4.0')).toBe(0)
    expect(compareVersions('4.1', '4.2')).toBeLessThan(0)
  })

  it('is entered by the admin: digits, a dot and digits', () => {
    for (const version of ['', '5', '4.', '.1', 'v4.1', '4.1.2', '4,1', 'four']) {
      expect(validate({ version }).version, version).toBe('version-invalid')
    }
    expect(validate({ version: ' 4.1 ' }).version).toBeUndefined()
  })

  it('must not exist already, even written differently', () => {
    expect(validate({ version: '4.0' }).version).toBe('version-exists')
    const older = { ...v40, id: 'gvp-3-0', version: '3.0' }
    expect(validate({ version: '3.0' }, [older, v40]).version).toBe('version-exists')
    expect(validate({ version: '4.00' }).version).toBe('version-exists')
  })

  it('must be higher than the current version (the latest added)', () => {
    expect(validate({ version: '3.9' }).version).toBe('version-not-higher')
    expect(validate({ version: '4.10' }, [{ ...v40, version: '4.9' }]).version).toBeUndefined()
    expect(validate({ version: '5.0' })).toEqual({})
  })
})

describe('the other fields', () => {
  it('requires a title of up to 100 characters', () => {
    expect(validate({ title: '  ' }).title).toBe('title-required')
    expect(validate({ title: 'x'.repeat(100) }).title).toBeUndefined()
    expect(validate({ title: 'x'.repeat(101) }).title).toBe('title-too-long')
  })

  it('requires a PDF file', () => {
    expect(validate({ fileName: '' }).fileName).toBe('file-required')
    expect(validate({ fileName: 'GVP.docx' }).fileName).toBe('file-not-pdf')
    expect(validate({ fileName: 'GVP.PDF' }).fileName).toBeUndefined()
  })

  it('needs the added date, and an issue date on or before it', () => {
    expect(validate({ addedDate: '' }).addedDate).toBe('added-required')
    expect(validate({ issuedDate: '2026-11-07' }).issuedDate).toBe('issued-after-added')
    expect(validate({ issuedDate: '2026-11-06' }).issuedDate).toBeUndefined()
    expect(validate({ issuedDate: '' }).issuedDate).toBeUndefined()
  })

  it('requires the source as a valid https:// link of up to 300 characters', () => {
    expect(validate({ source: ' ' }).source).toBe('source-required')
    for (const source of ['www.sfda.gov.sa', 'http://www.sfda.gov.sa', 'https://', 'https://sfda', 'https://www.sfda .gov.sa', 'ftp://sfda.gov.sa']) {
      expect(validate({ source }).source, source).toBe('source-invalid')
    }
    const long = 'https://www.sfda.gov.sa/' + 'x'.repeat(300 - 'https://www.sfda.gov.sa/'.length)
    expect(validate({ source: long }).source).toBeUndefined()
    expect(validate({ source: long + 'x' }).source).toBe('source-too-long')
    expect(isHttpsLink('https://www.sfda.gov.sa/en/regulations?page=1')).toBe(true)
  })

  it('accepts only official SFDA links: sfda.gov.sa or one of its subdomains, over https', () => {
    // Valid
    for (const source of ['https://sfda.gov.sa', 'https://www.sfda.gov.sa/en/regulations/gvp', 'https://WWW.SFDA.GOV.SA/ar', 'https://pv.sfda.gov.sa/guide.pdf?v=4.1']) {
      expect(validate({ source }).source, source).toBeUndefined()
      expect(isSfdaLink(source), source).toBe(true)
    }
    // Other sites
    for (const source of ['https://www.google.com', 'https://www.fda.gov/drugs', 'https://gov.sa']) {
      expect(validate({ source }).source, source).toBe('source-not-sfda')
    }
    // Look-alike hosts: never a "contains" match
    for (const source of [
      'https://sfda.gov.sa.example.com', 'https://www.sfda.gov.sa.evil.com/gvp', 'https://notsfda.gov.sa', 'https://sfda-gov.sa',
      'https://sfda.gov.sa@evil.com/gvp', 'https://evil.com/?next=https://www.sfda.gov.sa', 'https://evil.com/sfda.gov.sa',
    ]) {
      expect(validate({ source }).source, source).toBe('source-not-sfda')
      expect(isSfdaLink(source), source).toBe(false)
    }
    // http links get the https error
    for (const source of ['http://www.sfda.gov.sa', 'http://sfda.gov.sa/gvp']) {
      expect(validate({ source }).source, source).toBe('source-invalid')
      expect(isSfdaLink(source), source).toBe(false)
    }
  })

  it('becomes current when added, with its title, source and added date; the requirements are copied', () => {
    const added = newGuidelineVersion(input({ issuedDate: '2026-10-01' }), v40, 'nouf', '2026-11-06T07:00:00Z')
    expect(added).toMatchObject({
      id: 'gvp-4-1', title: 'SFDA GVP Guideline', version: '4.1', issuedDate: '2026-10-01', effectiveDate: '2026-11-06',
      source: 'https://www.sfda.gov.sa/en/regulations/gvp', addedById: 'nouf', addedAt: '2026-11-06T07:00:00Z',
    })
    expect(added).not.toHaveProperty('summary')
    // Without a file kept in this browser there is no link; with one, it is kept for preview and download.
    expect(added).not.toHaveProperty('fileUrl')
    expect(newGuidelineVersion(input({ fileUrl: 'blob:http://localhost/x' }), v40, 'nouf').fileUrl).toBe('blob:http://localhost/x')
    expect(currentVersion([v40, added])).toBe(added)
    expect(added.requirements).toEqual(v40.requirements)
    expect(added.requirements[0]).not.toBe(v40.requirements[0])
  })
})

describe('editing a version', () => {
  const v41: GuidelineVersion = { ...v40, id: 'gvp-4-1', version: '4.1', title: 'Old', issuedDate: '2026-10-01', source: 'https://www.sfda.gov.sa/old', addedAt: '2026-11-06T07:00:00Z' }

  it('checks only the title, the issue date and the source, with the same rules as adding', () => {
    expect(validateGuidelineEdit({ title: 'New', issuedDate: '', source: 'https://www.sfda.gov.sa/new' }, v41)).toEqual({ title: undefined, issuedDate: undefined, source: undefined })
    expect(validateGuidelineEdit({ title: '', issuedDate: '2026-11-07', source: 'https://example.com' }, v41)).toEqual({
      title: 'title-required', issuedDate: 'issued-after-added', source: 'source-not-sfda',
    })
  })

  it('changes only those three; the version, the added date and the file stay', () => {
    const edited = editedGuidelineVersion(v41, { title: '  New title ', issuedDate: '', source: 'https://www.sfda.gov.sa/new' })
    expect(edited).toEqual({ ...v41, title: 'New title', source: 'https://www.sfda.gov.sa/new', issuedDate: undefined })
    expect(edited).not.toHaveProperty('issuedDate')
  })
})

describe('deleting a version', () => {
  const v41: GuidelineVersion = { ...v40, id: 'gvp-4-1', version: '4.1' }
  const v50: GuidelineVersion = { ...v40, id: 'gvp-5-0', version: '5.0' }

  it('refuses the current version (the last added)', () => {
    expect(deleteVersionBlocker(v50, [v40, v41, v50], [])).toBe('current')
  })

  it('refuses a version any SOP has a running or completed check against', () => {
    for (const status of ['running', 'completed'] as const) {
      expect(deleteVersionBlocker(v40, [v40, v41, v50], [sop('draft', [check('1', '4.0', status)])]), status).toBe('checked')
    }
  })

  it('does not count failed checks: they produced no results', () => {
    expect(deleteVersionBlocker(v40, [v40, v41, v50], [sop('draft', [check('1', '4.0', 'failed')])])).toBeUndefined()
    // A failed check next to a completed one still blocks it.
    expect(deleteVersionBlocker(v40, [v40, v41, v50], [sop('draft', [check('1', '4.0', 'failed'), check('2', '4.0')])])).toBe('checked')
  })

  it('allows an older version nobody was checked against', () => {
    expect(deleteVersionBlocker(v41, [v40, v41, v50], [sop('draft', [check('1', '4.0')])])).toBeUndefined()
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
    const started = startCheck(before, gvp('4.1'), { manualBy: 'sara' })
    const after = completeCheck(started.sop, started.checkId)
    expect(latestCompletedChecksByVersion(after).length).toBe(1) // the newest report of SOP v1
    expect(after.complianceChecks.map((item) => item.guideline.version)).toEqual(['4.0', '4.1'])
    expect(after.complianceChecks[0]).toEqual(before.complianceChecks[0])
  })
})
