import { describe, expect, it } from 'vitest'
import type { ComplianceCheck, Sop } from '../data/mock/types'
import {
  addCoAuthor,
  approveAs,
  completeReview,
  isOverdue,
  nextVersion,
  publishAs,
  resubmit,
  returnAsApprover,
  returnAsReviewer,
  submitForReview,
  uploadNewVersion,
} from './workflow'

/*
 * People: Sara is the author and Reem her co-author. Noura and Faisal review;
 * Huda and Khalid approve.
 */
const SARA = 'sara'
const REEM = 'reem'
const NOURA = 'noura'
const FAISAL = 'faisal'
const HUDA = 'huda'
const KHALID = 'khalid'

const DAY_MS = 24 * 60 * 60 * 1000

/** The current GVP version. */
const GVP = '4.0'

/** A completed compliance check of this version (it doesn't have to pass). */
function completedCheck(version: string): ComplianceCheck {
  return {
    id: `chk-${version}`,
    sopId: 'sop-1',
    version,
    status: 'completed',
    startedAt: '2026-01-01T09:00:00Z',
    completedAt: '2026-01-01T09:00:03Z',
    guideline: { name: 'GVP', version: GVP },
    findings: [{ id: 'f1', requirementId: 'R1', result: 'conflict', justification: '' }],
  }
}

/** Sara's draft v1.0 (co-authored by Reem), already checked for compliance. */
function draft(overrides: Partial<Sop> = {}): Sop {
  return {
    id: 'sop-1',
    code: 'SOP-001',
    title: 'Test SOP',
    departmentId: 'information-technology',
    version: '1.0',
    status: 'draft',
    lastUpdated: '2026-01-01',
    authorId: SARA,
    coAuthorIds: [REEM],
    fileName: 'SOP-001.pdf',
    fileType: 'pdf',
    reviewers: [],
    approvers: [],
    versions: [{ version: '1.0', fileName: 'SOP-001.pdf', fileType: 'pdf', uploadedAt: '2026-01-01T08:00:00Z' }],
    comments: [],
    timeline: [],
    complianceChecks: [completedCheck('1.0')],
    ...overrides,
  }
}

/** Submitted to Noura and Faisal (reviewers) and Huda and Khalid (approvers), with 5 and 3 due days. */
function inReview(): Sop {
  return submitForReview(draft(), SARA, GVP, [NOURA, FAISAL], [HUDA, KHALID], 5, 3)
}

/** Both reviewers completed: In Approval. */
function inApproval(): Sop {
  return completeReview(completeReview(inReview(), NOURA), FAISAL)
}

const decisions = (people: { userId: string; decision: string }[]) =>
  Object.fromEntries(people.map((person) => [person.userId, person.decision]))

describe('submitting for review', () => {
  it('needs a completed compliance check of the current version (a failing result is fine)', () => {
    expect(() => submitForReview(draft({ complianceChecks: [] }), SARA, GVP, [NOURA], [HUDA], undefined, undefined)).toThrow(
      /compliance check/,
    )
    const running: ComplianceCheck = { ...completedCheck('1.0'), status: 'running', findings: [] }
    expect(() => submitForReview(draft({ complianceChecks: [running] }), SARA, GVP, [NOURA], [HUDA], undefined, undefined)).toThrow()
    const failed: ComplianceCheck = { ...completedCheck('1.0'), status: 'failed', findings: [] }
    expect(() => submitForReview(draft({ complianceChecks: [failed] }), SARA, GVP, [NOURA], [HUDA], undefined, undefined)).toThrow()
    // A check of an older version doesn't count.
    expect(() =>
      submitForReview(draft({ version: '1.1', complianceChecks: [completedCheck('1.0')] }), SARA, GVP, [NOURA], [HUDA], undefined, undefined),
    ).toThrow()

    const submitted = inReview()
    expect(submitted.status).toBe('in-review')
    expect(decisions(submitted.reviewers)).toEqual({ [NOURA]: 'pending', [FAISAL]: 'pending' })
    expect(decisions(submitted.approvers)).toEqual({ [HUDA]: 'pending', [KHALID]: 'pending' })
  })

  it('needs at least one reviewer and one approver', () => {
    expect(() => submitForReview(draft(), SARA, GVP, [], [HUDA], undefined, undefined)).toThrow()
    expect(() => submitForReview(draft(), SARA, GVP, [NOURA], [], undefined, undefined)).toThrow()
  })
})

describe('reviewers work in parallel', () => {
  it('moves to In Approval only when ALL reviewers have completed', () => {
    const one = completeReview(inReview(), NOURA)
    expect(one.status).toBe('in-review')
    const both = completeReview(one, FAISAL)
    expect(both.status).toBe('in-approval')
  })

  it('goes back to the author as soon as ANY reviewer returns it', () => {
    const returned = returnAsReviewer(inReview(), FAISAL, 'Please add the retention period.')
    expect(returned.status).toBe('returned')
    expect(decisions(returned.reviewers)).toEqual({ [NOURA]: 'pending', [FAISAL]: 'returned' })
    expect(returned.comments.map((comment) => comment.text)).toEqual(['Please add the retention period.'])
  })
})

describe('approvers work in parallel', () => {
  it('is Approved only when ALL approvers have approved, then any approver can publish', () => {
    const one = approveAs(inApproval(), HUDA)
    expect(one.status).toBe('in-approval')
    const both = approveAs(one, KHALID)
    expect(both.status).toBe('approved')
    expect(publishAs(both, KHALID).status).toBe('published')
  })

  it('goes back to the author as soon as ANY approver returns it', () => {
    const returned = returnAsApprover(approveAs(inApproval(), HUDA), KHALID, 'Wrong owner listed.')
    expect(returned.status).toBe('returned')
    expect(decisions(returned.approvers)).toEqual({ [HUDA]: 'approved', [KHALID]: 'returned' })
  })
})

describe('resubmitting', () => {
  /** Returned by Faisal, then a new version (1.1) uploaded by co-author Reem and checked. */
  function readyToResubmit(): Sop {
    const returned = returnAsReviewer(completeReview(inReview(), NOURA), FAISAL, 'Fix section 4.')
    const updated = uploadNewVersion(returned, REEM, { fileName: 'SOP-001 v1.1.pdf', fileType: 'pdf' })
    return { ...updated, complianceChecks: [...updated.complianceChecks, completedCheck('1.1')] }
  }

  it('needs a new version uploaded since the return', () => {
    const returned = returnAsReviewer(inReview(), FAISAL, 'Fix section 4.')
    expect(() => resubmit(returned, SARA, GVP)).toThrow(/new version/)
  })

  it('resets every decision and keeps the same people and due days', () => {
    const before = readyToResubmit()
    const again = resubmit(before, SARA, GVP)
    expect(again.status).toBe('in-review')
    expect(again.version).toBe('1.1')
    expect(decisions(again.reviewers)).toEqual({ [NOURA]: 'pending', [FAISAL]: 'pending' })
    expect(decisions(again.approvers)).toEqual({ [HUDA]: 'pending', [KHALID]: 'pending' })
    expect([again.reviewDueDays, again.approvalDueDays]).toEqual([5, 3])
    expect(again.reviewDueAt).toBeDefined()
  })

  it('needs a completed compliance check of the new version', () => {
    const returned = returnAsReviewer(inReview(), FAISAL, 'Fix section 4.')
    const updated = uploadNewVersion(returned, SARA, { fileName: 'SOP-001 v1.1.pdf', fileType: 'pdf' })
    expect(() => resubmit(updated, SARA, GVP)).toThrow(/compliance check/)
  })
})

describe('separation of duties', () => {
  it('never lets the author or a co-author review or approve', () => {
    expect(() => submitForReview(draft(), SARA, GVP, [SARA], [HUDA], undefined, undefined)).toThrow()
    expect(() => submitForReview(draft(), SARA, GVP, [NOURA], [REEM], undefined, undefined)).toThrow()
  })

  it('never lets the same person both review and approve', () => {
    expect(() => submitForReview(draft(), SARA, GVP, [NOURA], [NOURA, HUDA], undefined, undefined)).toThrow()
  })

  it('never adds a reviewer or approver as a co-author', () => {
    expect(() => addCoAuthor(inReview(), SARA, NOURA)).toThrow()
    expect(() => addCoAuthor(inReview(), SARA, HUDA)).toThrow()
  })
})

describe('optional due dates', () => {
  it('has no due date, and is never overdue, when no due days were set', () => {
    const submitted = submitForReview(draft(), SARA, GVP, [NOURA], [HUDA], undefined, undefined)
    expect(submitted.reviewDueAt).toBeUndefined()
    expect(isOverdue(submitted, 'review', Date.now() + 365 * DAY_MS)).toBe(false)
    const approval = completeReview(submitted, NOURA)
    expect(approval.approvalDueAt).toBeUndefined()
    expect(isOverdue(approval, 'approval', Date.now() + 365 * DAY_MS)).toBe(false)
  })

  it('is overdue after the due date, only while that stage is open', () => {
    const submitted = submitForReview(draft(), SARA, GVP, [NOURA], [HUDA], 2, undefined)
    expect(isOverdue(submitted, 'review', Date.now() + 1 * DAY_MS)).toBe(false)
    expect(isOverdue(submitted, 'review', Date.now() + 3 * DAY_MS)).toBe(true)
    expect(isOverdue(completeReview(submitted, NOURA), 'review', Date.now() + 3 * DAY_MS)).toBe(false)
  })

  it('accepts only whole numbers of days from 1 to 30', () => {
    for (const days of [0, 31, 1.5]) {
      expect(() => submitForReview(draft(), SARA, GVP, [NOURA], [HUDA], days, undefined)).toThrow(/1 to 30/)
    }
    expect(() => submitForReview(draft(), SARA, GVP, [NOURA], [HUDA], 1, 30)).not.toThrow()
  })
})

describe('version numbering', () => {
  it('adds 0.1 in decimal steps', () => {
    expect(nextVersion('1.0')).toBe('1.1')
    expect(nextVersion('1.9')).toBe('2.0')
    expect(nextVersion('2.9')).toBe('3.0')
  })
})

describe('invalid actions are refused', () => {
  it('only the main author submits (not a co-author)', () => {
    expect(() => submitForReview(draft(), REEM, GVP, [NOURA], [HUDA], undefined, undefined)).toThrow()
  })

  it('only pending, assigned people decide, at their own stage', () => {
    expect(() => completeReview(inReview(), HUDA)).toThrow() // not a reviewer
    expect(() => completeReview(completeReview(inReview(), NOURA), NOURA)).toThrow() // already decided
    expect(() => approveAs(inReview(), HUDA)).toThrow() // still in review
    expect(() => completeReview(draft(), NOURA)).toThrow() // not submitted
  })

  it('a return needs a comment', () => {
    expect(() => returnAsReviewer(inReview(), NOURA, '   ')).toThrow()
  })

  it('only an assigned approver publishes, and only an approved SOP', () => {
    const approved = approveAs(approveAs(inApproval(), HUDA), KHALID)
    expect(() => publishAs(approved, NOURA)).toThrow()
    expect(() => publishAs(inApproval(), HUDA)).toThrow()
  })

  it('a new version can only be uploaded after a return', () => {
    expect(() => uploadNewVersion(draft(), SARA, { fileName: 'x.pdf', fileType: 'pdf' })).toThrow()
  })
})
