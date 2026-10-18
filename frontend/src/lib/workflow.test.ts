import { describe, expect, it, vi } from 'vitest'
import type { ComplianceCheck, Sop, User } from '../data/mock/types'
import {
  addCoAuthor,
  addResponse,
  approveAs,
  assertCanRunCheck,
  canResubmit,
  checkBlocker,
  commentForEvent,
  completeReview,
  daysFromToday,
  defaultAssignees,
  deleteVersion,
  deleteVersionBlocker,
  dueDateRange,
  isOverdue,
  nextVersion,
  parseDueDate,
  publishAs,
  removeCoAuthor,
  resubmit,
  responseRecipients,
  returnAsApprover,
  returnAsReviewer,
  routeToReviewer,
  submitForReview,
  timelineRecipients,
  uploadVersion,
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

/** Sara's draft v1 (co-authored by Reem), already checked for compliance. */
function draft(overrides: Partial<Sop> = {}): Sop {
  return {
    id: 'sop-1',
    code: 'SOP-001',
    title: 'Test SOP',
    departmentId: 'information-technology',
    version: '1',
    status: 'draft',
    lastUpdated: '2026-01-01',
    authorId: SARA,
    coAuthorIds: [REEM],
    fileName: 'SOP-001.pdf',
    fileType: 'pdf',
    reviewers: [],
    approvers: [],
    versions: [{ version: '1', fileName: 'SOP-001.pdf', fileType: 'pdf', uploadedAt: '2026-01-01T08:00:00Z' }],
    comments: [],
    timeline: [],
    complianceChecks: [completedCheck('1')],
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
    const running: ComplianceCheck = { ...completedCheck('1'), status: 'running', findings: [] }
    expect(() => submitForReview(draft({ complianceChecks: [running] }), SARA, GVP, [NOURA], [HUDA], undefined, undefined)).toThrow()
    const failed: ComplianceCheck = { ...completedCheck('1'), status: 'failed', findings: [] }
    expect(() => submitForReview(draft({ complianceChecks: [failed] }), SARA, GVP, [NOURA], [HUDA], undefined, undefined)).toThrow()
    // A check of an older version doesn't count.
    expect(() =>
      submitForReview(draft({ version: '2', complianceChecks: [completedCheck('1')] }), SARA, GVP, [NOURA], [HUDA], undefined, undefined),
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

describe('reviewers work one after another', () => {
  it('only lets the current reviewer (the first pending one) complete their review', () => {
    // Noura was assigned first, so it's her turn; Faisal's comes after.
    expect(() => completeReview(inReview(), FAISAL)).toThrow(/current reviewer/)
    expect(completeReview(inReview(), NOURA).status).toBe('in-review')
  })

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
  /** Returned by Faisal, then a new version (v2) uploaded by co-author Reem and checked. */
  function readyToResubmit(): Sop {
    const returned = returnAsReviewer(completeReview(inReview(), NOURA), FAISAL, 'Fix section 4.')
    const updated = uploadVersion(returned, REEM, { fileName: 'SOP-001 v2.pdf', fileType: 'pdf' })
    return { ...updated, complianceChecks: [...updated.complianceChecks, completedCheck('2')] }
  }

  it('needs a new version uploaded since the return', () => {
    const returned = returnAsReviewer(inReview(), FAISAL, 'Fix section 4.')
    expect(() => resubmit(returned, SARA, GVP)).toThrow(/new version/)
  })

  it('resets every decision and keeps the same people and due days', () => {
    const before = readyToResubmit()
    const again = resubmit(before, SARA, GVP)
    expect(again.status).toBe('in-review')
    expect(again.version).toBe('2')
    expect(decisions(again.reviewers)).toEqual({ [NOURA]: 'pending', [FAISAL]: 'pending' })
    expect(decisions(again.approvers)).toEqual({ [HUDA]: 'pending', [KHALID]: 'pending' })
    expect([again.reviewDueDays, again.approvalDueDays]).toEqual([5, 3])
    expect(again.reviewDueAt).toBeDefined()
  })

  it('needs a completed compliance check of the new version', () => {
    const returned = returnAsReviewer(inReview(), FAISAL, 'Fix section 4.')
    const updated = uploadVersion(returned, SARA, { fileName: 'SOP-001 v2.pdf', fileType: 'pdf' })
    expect(() => resubmit(updated, SARA, GVP)).toThrow(/compliance check/)
  })

  it('is not allowed after deleting back to a version from before the return', () => {
    const before = readyToResubmit()
    expect(canResubmit(before)).toBe(true)
    const back = deleteVersion(before, SARA, '2')
    expect(back.version).toBe('1')
    expect(canResubmit(back)).toBe(false)
    expect(() => resubmit(back, SARA, GVP)).toThrow(/new version/)
  })

  it('only the main author resubmits', () => {
    expect(() => resubmit(readyToResubmit(), REEM, GVP)).toThrow()
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
  const file = { fileName: 'SOP-001.pdf', fileType: 'pdf' as const }

  it('uses the next whole number', () => {
    expect(nextVersion(draft())).toBe('2')
    const v2 = uploadVersion(draft(), SARA, file)
    expect(nextVersion(v2)).toBe('3')
  })

  it('makes every upload a new current version, by the author or a co-author', () => {
    const v2 = uploadVersion(draft(), SARA, { fileName: 'b.docx', fileType: 'docx' })
    const v3 = uploadVersion(v2, REEM, { fileName: 'c.pdf', fileType: 'pdf' })
    expect(v3.versions.map((item) => [item.version, item.uploadedById])).toEqual([
      ['1', undefined],
      ['2', SARA],
      ['3', REEM],
    ])
    expect([v3.version, v3.fileName, v3.fileType]).toEqual(['3', 'c.pdf', 'pdf'])
    expect(v3.timeline.map((item) => [item.type, item.version])).toEqual([
      ['version-uploaded', '2'],
      ['version-uploaded', '3'],
    ])
  })

  it('never reuses the number of a deleted version', () => {
    const v2 = uploadVersion(draft(), SARA, file)
    const deleted = deleteVersion(v2, SARA, '2')
    expect(nextVersion(deleted)).toBe('3')
    expect(uploadVersion(deleted, SARA, file).version).toBe('3')
  })

  it('uploads only while Draft or Returned, by an author', () => {
    expect(() => uploadVersion(inReview(), SARA, file)).toThrow()
    expect(() => uploadVersion(inApproval(), SARA, file)).toThrow()
    expect(() => uploadVersion(draft(), NOURA, file)).toThrow()
    expect(() => uploadVersion(returnAsReviewer(inReview(), NOURA, 'Fix.'), REEM, file)).not.toThrow()
  })
})

describe('deleting a version', () => {
  const file = { fileName: 'SOP-001 v2.docx', fileType: 'docx' as const }
  /** Draft with v1 (pdf) and v2 (docx); v2 current. */
  const twoVersions = () =>
    uploadVersion(
      draft({ fileUrl: 'blob:v1', versions: [{ ...draft().versions[0], fileUrl: 'blob:v1' }] }),
      SARA,
      file,
    )

  /** Draft with v1 (main author Sara's) and v2 uploaded by co-author Reem; v2 current. */
  const withReemVersion = () => uploadVersion(draft(), REEM, file)

  /** The same SOP (v2 by Reem, checked) in each status. */
  function inEachStatus() {
    const submitted = submitForReview(
      { ...withReemVersion(), complianceChecks: [completedCheck('2')] },
      SARA,
      GVP,
      [NOURA],
      [HUDA],
      undefined,
      undefined,
    )
    const inApprovalStage = completeReview(submitted, NOURA)
    const approved = approveAs(inApprovalStage, HUDA)
    return {
      draft: withReemVersion(),
      returnedByReviewer: returnAsReviewer(submitted, NOURA, 'Fix.'),
      returnedByApprover: returnAsApprover(inApprovalStage, HUDA, 'Fix.'),
      inReview: submitted,
      inApproval: inApprovalStage,
      approved,
      published: publishAs(approved, HUDA),
    }
  }

  it('lets the main author delete any version', () => {
    const sop = withReemVersion()
    expect(deleteVersionBlocker(sop, SARA, '1')).toBeUndefined()
    expect(deleteVersionBlocker(sop, SARA, '2')).toBeUndefined() // uploaded by co-author Reem
    expect(deleteVersion(sop, SARA, '2').versions.find((item) => item.version === '2')?.deletedAt).toBeDefined()
    expect(deleteVersion(sop, SARA, '1').versions.find((item) => item.version === '1')?.deletedAt).toBeDefined()
  })

  it('lets a co-author delete only the versions they uploaded', () => {
    const sop = withReemVersion()
    expect(deleteVersionBlocker(sop, REEM, '2')).toBeUndefined()
    expect(deleteVersion(sop, REEM, '2').versions.find((item) => item.version === '2')).toMatchObject({ deletedById: REEM })
    expect(deleteVersionBlocker(sop, REEM, '1')).toBe('not-uploader')
    expect(() => deleteVersion(sop, REEM, '1')).toThrow(/uploaded/)
    // Someone who isn't an author can't delete anything.
    expect(deleteVersionBlocker(sop, NOURA, '2')).toBe('not-uploader')
    expect(() => deleteVersion(sop, NOURA, '2')).toThrow()
  })

  it('is allowed only while Draft or Returned, for the main author and a co-author alike', () => {
    const sops = inEachStatus()
    // Returned is its own status (shown on the step it came from), never treated as In Review or In Approval.
    for (const sop of [sops.draft, sops.returnedByReviewer, sops.returnedByApprover]) {
      expect(deleteVersionBlocker(sop, SARA, '1')).toBeUndefined()
      expect(deleteVersionBlocker(sop, REEM, '2')).toBeUndefined()
      expect(() => deleteVersion(sop, REEM, '2')).not.toThrow()
    }
    for (const sop of [sops.inReview, sops.inApproval, sops.approved, sops.published]) {
      expect(deleteVersionBlocker(sop, SARA, '1')).toBe('status')
      expect(deleteVersionBlocker(sop, REEM, '2')).toBe('status')
      expect(() => deleteVersion(sop, SARA, '1')).toThrow(sop.status)
      expect(() => deleteVersion(sop, REEM, '2')).toThrow(sop.status)
    }
  })

  it('keeps at least one version', () => {
    expect(deleteVersionBlocker(draft(), SARA, '1')).toBe('last-version')
    expect(() => deleteVersion(draft(), SARA, '1')).toThrow(/one version/)
    const one = deleteVersion(twoVersions(), SARA, '1')
    expect(deleteVersionBlocker(one, SARA, '2')).toBe('last-version')
    // Also for a co-author's own last version.
    const reemOnly = deleteVersion(withReemVersion(), SARA, '1')
    expect(deleteVersionBlocker(reemOnly, REEM, '2')).toBe('last-version')
  })

  it('makes the previous version current when the latest is deleted', () => {
    const back = deleteVersion(twoVersions(), SARA, '2')
    expect([back.version, back.fileName, back.fileType, back.fileUrl]).toEqual(['1', 'SOP-001.pdf', 'pdf', 'blob:v1'])
    expect(back.versions.find((item) => item.version === '2')).toMatchObject({ deletedById: SARA })
    expect(back.versions.find((item) => item.version === '2')?.deletedAt).toBeDefined()
    expect(back.timeline.at(-1)).toMatchObject({ type: 'version-deleted', actorId: SARA, version: '2' })
  })

  it('keeps the current version when an older one is deleted', () => {
    const kept = deleteVersion(twoVersions(), SARA, '1')
    expect([kept.version, kept.fileName]).toEqual(['2', 'SOP-001 v2.docx'])
    expect(kept.timeline.at(-1)).toMatchObject({ type: 'version-deleted', version: '1' })
    expect(() => deleteVersion(kept, SARA, '1')).toThrow() // already deleted
  })

  it('lets a co-author delete the current version they uploaded (the previous one becomes current)', () => {
    const back = deleteVersion(withReemVersion(), REEM, '2')
    expect(back.version).toBe('1')
  })
})

describe('running a compliance check', () => {
  const file = { fileName: 'SOP-001 v2.pdf', fileType: 'pdf' as const }

  it('lets the main author run it whoever uploaded the current version', () => {
    expect(checkBlocker(draft(), SARA)).toBeUndefined()
    const reemCurrent = uploadVersion(draft(), REEM, file)
    expect(checkBlocker(reemCurrent, SARA)).toBeUndefined()
    expect(() => assertCanRunCheck(reemCurrent, SARA)).not.toThrow()
  })

  it('lets a co-author run it only when they uploaded the current version', () => {
    // v1 is the main author's.
    expect(checkBlocker(draft(), REEM)).toBe('not-uploader')
    expect(() => assertCanRunCheck(draft(), REEM)).toThrow(/uploader/)
    const reemCurrent = uploadVersion(draft(), REEM, file)
    expect(checkBlocker(reemCurrent, REEM)).toBeUndefined()
    // Sara uploads v3: no longer Reem's version.
    expect(checkBlocker(uploadVersion(reemCurrent, SARA, file), REEM)).toBe('not-uploader')
    // Reem's v2 deleted: Sara's v1 is current again.
    expect(checkBlocker(deleteVersion(reemCurrent, SARA, '2'), REEM)).toBe('not-uploader')
  })

  it('never lets someone who isn’t an author run it', () => {
    expect(checkBlocker(draft(), NOURA)).toBe('not-uploader')
  })

  /** The same SOP (current v2 uploaded by co-author Reem, checked) in each status. */
  function inEachStatus() {
    const reemCurrent = { ...uploadVersion(draft(), REEM, file), complianceChecks: [completedCheck('2')] }
    const submitted = submitForReview(reemCurrent, SARA, GVP, [NOURA], [HUDA], undefined, undefined)
    const inApprovalStage = completeReview(submitted, NOURA)
    const approved = approveAs(inApprovalStage, HUDA)
    return {
      allowed: [
        reemCurrent,
        returnAsReviewer(submitted, NOURA, 'Fix.'),
        returnAsApprover(inApprovalStage, HUDA, 'Fix.'),
      ],
      blocked: [submitted, inApprovalStage, approved, publishAs(approved, HUDA)],
    }
  }

  it('is allowed while Draft or Returned (by a reviewer or an approver)', () => {
    for (const sop of inEachStatus().allowed) {
      expect(checkBlocker(sop, SARA)).toBeUndefined()
      expect(checkBlocker(sop, REEM)).toBeUndefined()
      expect(() => assertCanRunCheck(sop, REEM)).not.toThrow()
    }
  })

  it('is blocked In Review, In Approval, Approved and Published, for everyone', () => {
    const blocked = inEachStatus().blocked
    expect(blocked.map((sop) => sop.status)).toEqual(['in-review', 'in-approval', 'approved', 'published'])
    for (const sop of blocked) {
      expect(checkBlocker(sop, SARA)).toBe('status')
      expect(checkBlocker(sop, REEM)).toBe('status')
      expect(() => assertCanRunCheck(sop, SARA)).toThrow(sop.status)
    }
  })

  it('reports the status before the co-author rule', () => {
    // v1 is the main author's, so Reem is also not the uploader of the current version.
    const submitted = submitForReview(draft(), SARA, GVP, [NOURA], [HUDA], undefined, undefined)
    expect(checkBlocker(submitted, REEM)).toBe('status')
    expect(checkBlocker(returnAsReviewer(submitted, NOURA, 'Fix.'), REEM)).toBe('not-uploader')
  })
})

describe('uploading a version (unchanged)', () => {
  it('lets the main author and a co-author upload while Draft or Returned', () => {
    const file = { fileName: 'SOP-001 v2.pdf', fileType: 'pdf' as const }
    for (const sop of [draft(), returnAsReviewer(inReview(), NOURA, 'Fix.')]) {
      expect(uploadVersion(sop, SARA, file).version).toBe('2')
      expect(uploadVersion(sop, REEM, file).version).toBe('2')
    }
  })
})

describe('review due date (Submit for review)', () => {
  // Oct 18, 2026, 3:20 PM local time.
  const now = new Date(2026, 9, 18, 15, 20)

  it('allows tomorrow to 30 days from today', () => {
    expect(dueDateRange(now)).toEqual({ min: '2026-10-19', max: '2026-11-17' })
    expect(parseDueDate('2026-10-19', now)).toEqual({ valid: true, days: 1 })
    expect(parseDueDate('2026-10-23', now)).toEqual({ valid: true, days: 5 })
    expect(parseDueDate('2026-11-17', now)).toEqual({ valid: true, days: 30 })
  })

  it('refuses today, past dates, more than 30 days and dates that don’t exist', () => {
    for (const date of ['2026-10-18', '2026-10-01', '2026-11-18', '2026-02-30', 'not a date']) {
      expect(parseDueDate(date, now).valid).toBe(false)
    }
  })

  it('is optional: empty means no due date', () => {
    expect(parseDueDate('', now)).toEqual({ valid: true })
  })

  it('counts calendar days, whatever the time of day or a daylight-saving change', () => {
    expect(daysFromToday('2026-10-19', new Date(2026, 9, 18, 23, 59))).toBe(1)
    expect(daysFromToday('2026-10-19', new Date(2026, 9, 18, 0, 1))).toBe(1)
    // Late March and late October cross daylight-saving changes in many time zones.
    expect(daysFromToday('2026-04-05', new Date(2026, 2, 20, 12))).toBe(16)
    expect(daysFromToday('2026-11-05', new Date(2026, 9, 20, 12))).toBe(16)
  })

  it('is due at the time of day it was submitted (5 days later), with no approval due date', () => {
    const submitted = submitForReview(draft(), SARA, GVP, [NOURA], [HUDA], 5, undefined)
    const submittedAt = submitted.timeline.find((item) => item.type === 'submitted')!.createdAt
    expect(new Date(submitted.reviewDueAt!).getTime() - new Date(submittedAt).getTime()).toBe(5 * DAY_MS)
    expect(submitted.approvalDueAt).toBeUndefined()
  })
})

describe('default reviewers and approvers (temporary rule)', () => {
  const person = (id: string, departmentId: string, permissions: User['permissions'], deletedAt?: string) => ({
    id,
    departmentId,
    permissions,
    deletedAt,
  })
  const users = [
    person(SARA, 'information-technology', ['author']),
    person(NOURA, 'information-technology', ['reviewer']),
    person(HUDA, 'information-technology', ['approver']),
    person(FAISAL, 'quality-assurance', ['reviewer']),
    person(KHALID, 'quality-assurance', ['approver']),
    person('gone', 'information-technology', ['reviewer'], '2026-01-01T00:00:00Z'),
  ]

  it('assigns the active reviewers and approvers of the SOP’s department', () => {
    expect(defaultAssignees(draft(), users)).toEqual({ reviewerIds: [NOURA], approverIds: [HUDA] })
  })

  it('never assigns an author or co-author, and someone with both permissions only reviews', () => {
    const both = person('both', 'information-technology', ['reviewer', 'approver'])
    const coAuthorReviewer = person(REEM, 'information-technology', ['reviewer'])
    expect(defaultAssignees(draft(), [...users, both, coAuthorReviewer])).toEqual({
      reviewerIds: [NOURA, 'both'],
      approverIds: [HUDA],
    })
  })

  it('is empty when the department has nobody (Submit is then blocked)', () => {
    expect(defaultAssignees(draft({ departmentId: 'pharmacovigilance' }), users)).toEqual({ reviewerIds: [], approverIds: [] })
  })

  it('sends the submitted SOP to them', () => {
    const { reviewerIds, approverIds } = defaultAssignees(draft(), users)
    const submitted = submitForReview(draft(), SARA, GVP, reviewerIds, approverIds, undefined, undefined)
    expect(decisions(submitted.reviewers)).toEqual({ [NOURA]: 'pending' })
    expect(decisions(submitted.approvers)).toEqual({ [HUDA]: 'pending' })
    expect(submitted.timeline.find((item) => item.type === 'submitted')).toMatchObject({ recipientIds: [NOURA] })
  })
})

describe('timeline recipients (display)', () => {
  const returnEvent = (sop: Sop) => sop.timeline.findLast((item) => item.type === 'returned')!

  it('shows a return as sent to the main author only on the author’s page', () => {
    const byReviewer = returnAsReviewer(inReview(), NOURA, 'Fix section 4.')
    expect(returnEvent(byReviewer).recipientIds).toEqual([SARA, REEM]) // stored recipients (notifications) unchanged
    expect(timelineRecipients(byReviewer, returnEvent(byReviewer), true)).toEqual([SARA])
    const byApprover = returnAsApprover(inApproval(), HUDA, 'Wrong owner listed.')
    expect(timelineRecipients(byApprover, returnEvent(byApprover), true)).toEqual([SARA])
  })

  it('keeps every recipient without mainAuthorOnly (the review page)', () => {
    const returned = returnAsReviewer(inReview(), NOURA, 'Fix section 4.')
    expect(timelineRecipients(returned, returnEvent(returned))).toEqual([SARA, REEM])
  })

  it('leaves rows addressed to others unchanged', () => {
    const submitted = inReview()
    const submit = submitted.timeline.find((item) => item.type === 'submitted')!
    expect(timelineRecipients(submitted, submit, true)).toEqual([NOURA, FAISAL])
    const responded = addResponse(returnAsReviewer(submitted, NOURA, 'Fix.'), REEM, 'Done.')
    expect(timelineRecipients(responded, responded.timeline.at(-1)!, true)).toEqual([NOURA])
  })

  it('doesn’t list a co-author who was removed after the return', () => {
    const returned = returnAsReviewer(inReview(), NOURA, 'Fix section 4.')
    const removed = removeCoAuthor(returned, SARA, REEM)
    expect(timelineRecipients(removed, returnEvent(removed), true)).toEqual([SARA])
  })
})

describe('responding to comments', () => {
  it('goes to everyone who commented in the latest round', () => {
    const reviewed = completeReview(inReview(), NOURA, 'Minor wording.')
    const returned = returnAsReviewer(reviewed, FAISAL, 'Fix section 4.')
    expect(responseRecipients(returned)).toEqual([NOURA, FAISAL])
    const responded = addResponse(returned, REEM, '  Fixed in the next version.  ')
    expect(responded.timeline.at(-1)).toMatchObject({
      type: 'response',
      actorId: REEM,
      recipientIds: [NOURA, FAISAL],
      note: 'Fixed in the next version.',
    })
    expect(responded.status).toBe('returned')
  })

  it('leaves out comments from earlier rounds', () => {
    // Each step a second apart, so the rounds don't share a timestamp.
    vi.useFakeTimers({ now: new Date('2026-03-01T08:00:00Z') })
    const tick = () => vi.advanceTimersByTime(1000)
    // Round 1: Noura (the current reviewer) returns it.
    const returned = returnAsReviewer(inReview(), NOURA, 'Fix section 4.')
    tick()
    const updated = uploadVersion(returned, SARA, { fileName: 'v2.pdf', fileType: 'pdf' })
    tick()
    const again = resubmit({ ...updated, complianceChecks: [...updated.complianceChecks, completedCheck('2')] }, SARA, GVP)
    tick()
    // Round 2: Noura completes, then Faisal returns it. Noura's round-1 comment is left out.
    const secondReturn = returnAsReviewer(completeReview(again, NOURA), FAISAL, 'Still missing the owner.')
    vi.useRealTimers()
    expect(responseRecipients(secondReturn)).toEqual([FAISAL])
  })

  it('needs comments to respond to, a text of up to 1000 characters, and an author', () => {
    expect(responseRecipients(draft())).toEqual([])
    expect(() => addResponse(draft(), SARA, 'Hello')).toThrow(/no comments/)
    const returned = returnAsReviewer(inReview(), NOURA, 'Fix.')
    expect(() => addResponse(returned, SARA, '   ')).toThrow()
    expect(() => addResponse(returned, SARA, 'x'.repeat(1001))).toThrow()
    expect(() => addResponse(returned, SARA, 'x'.repeat(1000))).not.toThrow()
    expect(() => addResponse(returned, NOURA, 'Reply')).toThrow()
  })

  it('is allowed in any status except Published', () => {
    const reviewed = completeReview(inReview(), NOURA, 'Good.')
    expect(() => addResponse(reviewed, SARA, 'Thanks')).not.toThrow()
    const approved = approveAs(approveAs(completeReview(reviewed, FAISAL), HUDA), KHALID)
    expect(() => addResponse(approved, SARA, 'Thanks')).not.toThrow()
    expect(() => addResponse(publishAs(approved, HUDA), SARA, 'Thanks')).toThrow(/published/)
  })
})

describe('comments linked to timeline events', () => {
  it('finds the comment saved with a return or a decision', () => {
    const returned = returnAsReviewer(completeReview(inReview(), NOURA, 'Fine by me.'), FAISAL, 'Fix section 4.')
    const completed = returned.timeline.find((item) => item.type === 'review-completed')!
    const returnEvent = returned.timeline.find((item) => item.type === 'returned')!
    expect(commentForEvent(returned, completed)?.text).toBe('Fine by me.')
    expect(commentForEvent(returned, returnEvent)?.text).toBe('Fix section 4.')
    const submitted = returned.timeline.find((item) => item.type === 'submitted')!
    expect(commentForEvent(returned, submitted)).toBeUndefined()
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

  it('a version can only be uploaded while Draft or Returned', () => {
    expect(() => uploadVersion(inReview(), SARA, { fileName: 'x.pdf', fileType: 'pdf' })).toThrow()
  })
})

describe('routing to another department (PBI 23)', () => {
  /** A reviewer (by default from Pharmacovigilance; the SOP is in IT). */
  function person(id: string, overrides: Partial<User> = {}): User {
    return {
      id,
      name: id,
      email: `${id}@hawkim.demo`,
      initials: 'XX',
      departmentId: 'pharmacovigilance',
      permissions: ['reviewer'],
      ...overrides,
    }
  }
  const lama = person('lama')

  it('adds a pending reviewer from another department; the SOP waits for them too', () => {
    const submitted = inReview()
    // Noura is the current reviewer; Lama joins at the end of the order.
    const routed = routeToReviewer(submitted, NOURA, lama, '  Please check the PV parts.  ')
    expect(decisions(routed.reviewers)).toEqual({ [NOURA]: 'pending', [FAISAL]: 'pending', lama: 'pending' })
    expect(routed.reviewDueAt).toBe(submitted.reviewDueAt)
    expect(routed.timeline.at(-1)).toMatchObject({
      type: 'routed',
      actorId: NOURA,
      recipientIds: ['lama'],
      departmentId: 'pharmacovigilance',
      note: 'Please check the PV parts.',
    })
    const bothDone = completeReview(completeReview(routed, NOURA), FAISAL)
    expect(bothDone.status).toBe('in-review')
    expect(completeReview(bothDone, 'lama').status).toBe('in-approval')
  })

  it('resets the routed reviewer on resubmit, like everyone else', () => {
    // Noura routes Lama and completes; Faisal then returns it (Lama is still pending).
    const routed = completeReview(routeToReviewer(inReview(), NOURA, lama), NOURA)
    const returned = returnAsReviewer(routed, FAISAL, 'Fix it.')
    const updated = uploadVersion(returned, SARA, { fileName: 'v2.pdf', fileType: 'pdf' })
    const again = resubmit({ ...updated, complianceChecks: [...updated.complianceChecks, completedCheck('2')] }, SARA, GVP)
    expect(decisions(again.reviewers)).toEqual({ [NOURA]: 'pending', [FAISAL]: 'pending', lama: 'pending' })
  })

  it('is only for the current reviewer: not one who already completed, nor one whose turn hasn’t come', () => {
    // Faisal's turn hasn't come yet.
    expect(() => routeToReviewer(inReview(), FAISAL, lama)).toThrow(/current reviewer/)
    const nouraDone = completeReview(inReview(), NOURA)
    expect(() => routeToReviewer(nouraDone, NOURA, lama)).toThrow(/current reviewer/)
    const routed = routeToReviewer(nouraDone, FAISAL, lama)
    expect(decisions(routed.reviewers)).toEqual({ [NOURA]: 'completed', [FAISAL]: 'pending', lama: 'pending' })
    expect(routed.status).toBe('in-review')
  })

  it('is only for the current reviewer, while the SOP is In Review', () => {
    expect(() => routeToReviewer(inReview(), HUDA, lama)).toThrow(/current reviewer/)
    expect(() => routeToReviewer(inReview(), SARA, lama)).toThrow(/current reviewer/)
    expect(() => routeToReviewer(inApproval(), NOURA, lama)).toThrow()
    expect(() => routeToReviewer(draft(), NOURA, lama)).toThrow()
  })

  it('needs the Reviewer permission, another department and an active account', () => {
    expect(() => routeToReviewer(inReview(), FAISAL, person('maha', { permissions: ['approver'] }))).toThrow()
    expect(() => routeToReviewer(inReview(), FAISAL, person('reem2', { departmentId: 'information-technology' }))).toThrow()
    expect(() => routeToReviewer(inReview(), FAISAL, person('gone', { deletedAt: '2026-01-01T00:00:00Z' }))).toThrow()
  })

  it('keeps separation of duties: never the author, a co-author, a reviewer or an approver', () => {
    for (const id of [SARA, REEM, NOURA, HUDA]) {
      expect(() => routeToReviewer(inReview(), FAISAL, person(id)), id).toThrow()
    }
  })
})

describe('optional comments with a decision', () => {
  it('saves the comment with the reviewer or approver role, or nothing when empty', () => {
    const reviewed = completeReview(inReview(), NOURA, '  Looks good.  ')
    expect(reviewed.comments.map((comment) => [comment.authorUserId, comment.role, comment.text])).toEqual([
      [NOURA, 'reviewer', 'Looks good.'],
    ])
    expect(completeReview(inReview(), NOURA, '   ').comments).toEqual([])
    const approved = approveAs(inApproval(), HUDA, 'Approved for release.')
    expect(approved.comments.at(-1)).toMatchObject({ authorUserId: HUDA, role: 'approver', text: 'Approved for release.' })
  })
})
