import { describe, expect, it, vi } from 'vitest'
import type { ComplianceCheck, Sop, User } from '../data/mock/types'
import {
  addCoAuthor,
  addResponse,
  approveAs,
  canResubmit,
  commentForEvent,
  completeReview,
  deleteVersion,
  deleteVersionBlocker,
  isOverdue,
  nextVersion,
  publishAs,
  resubmit,
  responseRecipients,
  returnAsApprover,
  returnAsReviewer,
  routeToReviewer,
  submitForReview,
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

  it('is only while Draft or Returned', () => {
    const submitted = submitForReview(
      { ...twoVersions(), complianceChecks: [completedCheck('2')] },
      SARA,
      GVP,
      [NOURA],
      [HUDA],
      undefined,
      undefined,
    )
    expect(deleteVersionBlocker(submitted, SARA)).toBe('status')
    expect(() => deleteVersion(submitted, SARA, '1')).toThrow()
    const approved = approveAs(completeReview(submitted, NOURA), HUDA)
    expect(deleteVersionBlocker(approved, SARA)).toBe('status')
    expect(deleteVersionBlocker(publishAs(approved, HUDA), SARA)).toBe('status')
    const returned = returnAsReviewer(submitted, NOURA, 'Fix.')
    expect(deleteVersionBlocker(returned, SARA)).toBeUndefined()
  })

  it('is only for the main author (not a co-author)', () => {
    expect(deleteVersionBlocker(twoVersions(), REEM)).toBe('not-main-author')
    expect(() => deleteVersion(twoVersions(), REEM, '1')).toThrow()
    expect(() => deleteVersion(twoVersions(), NOURA, '1')).toThrow()
  })

  it('keeps at least one version', () => {
    expect(deleteVersionBlocker(draft(), SARA)).toBe('last-version')
    expect(() => deleteVersion(draft(), SARA, '1')).toThrow(/one version/)
    const one = deleteVersion(twoVersions(), SARA, '1')
    expect(deleteVersionBlocker(one, SARA)).toBe('last-version')
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
    const returned = returnAsReviewer(inReview(), FAISAL, 'Fix section 4.')
    tick()
    const updated = uploadVersion(returned, SARA, { fileName: 'v2.pdf', fileType: 'pdf' })
    tick()
    const again = resubmit({ ...updated, complianceChecks: [...updated.complianceChecks, completedCheck('2')] }, SARA, GVP)
    tick()
    const secondReturn = returnAsReviewer(completeReview(again, FAISAL), NOURA, 'Still missing the owner.')
    vi.useRealTimers()
    expect(responseRecipients(secondReturn)).toEqual([NOURA])
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
    const routed = routeToReviewer(submitted, FAISAL, lama, '  Please check the PV parts.  ')
    expect(decisions(routed.reviewers)).toEqual({ [NOURA]: 'pending', [FAISAL]: 'pending', lama: 'pending' })
    expect(routed.reviewDueAt).toBe(submitted.reviewDueAt)
    expect(routed.timeline.at(-1)).toMatchObject({
      type: 'routed',
      actorId: FAISAL,
      recipientIds: ['lama'],
      departmentId: 'pharmacovigilance',
      note: 'Please check the PV parts.',
    })
    const bothDone = completeReview(completeReview(routed, NOURA), FAISAL)
    expect(bothDone.status).toBe('in-review')
    expect(completeReview(bothDone, 'lama').status).toBe('in-approval')
  })

  it('resets the routed reviewer on resubmit, like everyone else', () => {
    const routed = completeReview(routeToReviewer(inReview(), FAISAL, lama), 'lama')
    const returned = returnAsReviewer(routed, NOURA, 'Fix it.')
    const updated = uploadVersion(returned, SARA, { fileName: 'v2.pdf', fileType: 'pdf' })
    const again = resubmit({ ...updated, complianceChecks: [...updated.complianceChecks, completedCheck('2')] }, SARA, GVP)
    expect(decisions(again.reviewers)).toEqual({ [NOURA]: 'pending', [FAISAL]: 'pending', lama: 'pending' })
  })

  it('is allowed for a reviewer who already completed their review, while the SOP is still In Review', () => {
    const faisalDone = completeReview(inReview(), FAISAL)
    const routed = routeToReviewer(faisalDone, FAISAL, lama)
    expect(decisions(routed.reviewers)).toEqual({ [NOURA]: 'pending', [FAISAL]: 'completed', lama: 'pending' })
    expect(routed.status).toBe('in-review')
  })

  it('is only for an assigned reviewer, while the SOP is In Review', () => {
    expect(() => routeToReviewer(inReview(), HUDA, lama)).toThrow(/assigned reviewer/)
    expect(() => routeToReviewer(inReview(), SARA, lama)).toThrow(/assigned reviewer/)
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
