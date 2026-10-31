import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ApprovalDecisionSnapshot, Department, Sop, User } from '../data/mock/types'
import { submitForApproval, type ApprovalSubmissionOptions } from '../lib/approval'
import { acceptInternalReview, currentInternalRound, decideInternalReview, startInternalReview, type InternalReviewOptions } from '../lib/internalReview'
import { activeApprovalSubmission, isApprover, returnAsApprover, uploadVersion } from '../lib/workflow'
import { fixedResponseDueDate } from '../lib/fixedResponseDeadline'
import { SopsProvider } from './SopsProvider'
import { useSops, type SopsStore } from './sopsContext'
// These store tests use working-day request deadlines as they behave once activated (lib/deadlinePolicy.ts).
vi.mock('../lib/deadlinePolicy', () => ({ WORKING_DAY_DEADLINES_ACTIVE: true }))

// Preserve the experimental adapter's mocked regression coverage without enabling
// a connection in the application's frontend-only prototype.

const fixture = vi.hoisted(() => ({
  userId: 'author', users: [] as User[], departments: [] as Department[], sops: [] as Sop[],
  commit: vi.fn<(sops: Sop[]) => void>(),
}))
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useState: (initial: unknown) => {
      const [state, setState] = react.useState(initial)
      return [state, (next: unknown) => { if (Array.isArray(next)) fixture.commit(next as Sop[]); setState(next) }] as const
    },
  }
})
vi.mock('../data/mock/sops', () => ({ sops: fixture.sops }))
vi.mock('./sessionContext', () => ({ useSession: () => ({ user: fixture.users.find((user) => user.id === fixture.userId) ?? null }) }))
vi.mock('./usersContext', () => ({ useUsers: () => ({ users: fixture.users, getUser: (id: string) => fixture.users.find((user) => user.id === id) }) }))
vi.mock('./departmentsContext', () => ({ useDepartments: () => ({ departments: fixture.departments }) }))
vi.mock('./guidelinesContext', () => ({ useGuidelines: () => ({ currentGuideline: { name: 'GVP', version: '4.0' } }) }))
/*
 * A stand-in for the database: each review function applies the same transition as
 * lib/internalReview.ts to the SOP (unanswered requests withdrawn first), and fetchSop
 * returns the result, which the store then merges and commits.
 */
const backend = vi.hoisted(() => ({ sop: undefined as Sop | undefined }))
vi.mock('../services/review', async () => {
  const lib = await import('../lib/internalReview')
  const workflow = await import('../lib/workflow')
  const apply = async (transition: (sop: Sop) => Sop) => { backend.sop = transition(lib.withdrawUnanswered(current())) }
  const roundOf = (sop: Sop) => lib.currentInternalRound(sop)!.id
  return {
    submitReview: (_id: string, o: InternalReviewOptions) => apply((sop) => sop.status === 'draft'
      ? lib.startInternalReview(sop, fixture.userId, '4.0', o, env())
      : lib.sendNewVersionForReview(sop, fixture.userId, '4.0', o, env())),
    addReviewers: (_id: string, o: InternalReviewOptions) => apply((sop) => lib.addInternalReviewers(sop, fixture.userId, o, env())),
    acceptReview: (requestId: string) => apply((sop) => lib.acceptInternalReview(sop, fixture.userId, roundOf(sop), requestId, env())),
    declineReview: (requestId: string, reason: string) => apply((sop) => lib.declineInternalReview(sop, fixture.userId, roundOf(sop), requestId, reason, env())),
    decideReview: (requestId: string, decision: 'completed' | 'returned', text?: string) => apply((sop) => lib.decideInternalReview(sop, fixture.userId, roundOf(sop), requestId, decision, text, env())),
    removeReviewer: (requestId: string, reason: string) => apply((sop) => lib.removeInternalReviewer(sop, fixture.userId, roundOf(sop), requestId, reason, env())),
    respondToComments: (_id: string, text: string) => apply((sop) => workflow.addResponse(sop, fixture.userId, text)),
    withdrawDueRequests: async () => {},
  }
})
vi.mock('../services/sops', () => ({ fetchSops: async () => [], fetchSop: async () => backend.sop }))

function person(id: string, permissions: User['permissions']): User {
  return { id, name: id, email: id + '@example.test', initials: 'TT', departmentId: 'home', permissions }
}
const env = () => ({ users: fixture.users, departments: fixture.departments })
const check = (version: string) => ({ id: 'check-' + version, sopId: 'test', version, status: 'completed' as const, startedAt: new Date().toISOString(), guideline: { name: 'GVP', version: '4.0' }, findings: [] })
function reviewed(deadlines: Pick<InternalReviewOptions, 'responseDueDate'> = {}): Sop {
  const draft: Sop = { id: 'test', code: 'TEST', title: 'Approval fixture', description: 'Preserved description', version: '1', departmentId: 'home', authorId: 'author', coAuthorIds: ['coauthor'], status: 'draft', lastUpdated: '2026-10-23', fileName: 'test.pdf', fileType: 'pdf', fileUrl: '/test.pdf', versions: [{ version: '1', fileName: 'test.pdf', fileType: 'pdf', fileUrl: '/test.pdf', uploadedAt: new Date().toISOString() }], reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [check('1')] }
  const started = startInternalReview(draft, 'author', '4.0', { reviewerIds: ['reviewer'], ...deadlines }, env())
  const round = currentInternalRound(started)!
  const accepted = acceptInternalReview(started, 'reviewer', round.id, round.assignments[0].id, env())
  return decideInternalReview(accepted, 'reviewer', round.id, round.assignments[0].id, 'completed', 'Checked this version', env())
}
function options(sop: Sop): ApprovalSubmissionOptions {
  return { version: sop.version, internalReviewRoundId: currentInternalRound(sop)!.id, noExternalReviewsRequired: true, feedbackAddressed: true, dueDate: '2026-10-28' }
}
function submitted(deadlines: Pick<InternalReviewOptions, 'responseDueDate'> = {}): Sop {
  const sop = reviewed(deadlines)
  return submitForApproval(sop, 'author', options(sop), env())
}
function snapshot(sop: Sop): ApprovalDecisionSnapshot {
  const approval = activeApprovalSubmission(sop)!
  return { version: approval.version, approvalSubmissionId: approval.id }
}
function capture(userId: string, sop: Sop): SopsStore {
  fixture.userId = userId
  fixture.sops.splice(0, fixture.sops.length, sop)
  fixture.commit.mockClear()
  const observe = vi.fn<(store: SopsStore) => void>()
  function Capture() { observe(useSops()); return null }
  renderToStaticMarkup(<SopsProvider><Capture /></SopsProvider>)
  return observe.mock.calls.at(-1)![0]
}
function current(): Sop { return (fixture.commit.mock.lastCall?.[0] ?? fixture.sops)[0] }
async function restartedReview(): Promise<Sop> {
  const sop = submitted({ responseDueDate: fixedResponseDueDate() })
  const returned = returnAsApprover(sop, 'controller', 'Revise this SOP', snapshot(sop))
  vi.advanceTimersByTime(1000)
  const revised = uploadVersion(returned, 'author', { fileName: 'revised.pdf', fileType: 'pdf' })
  revised.complianceChecks = [...revised.complianceChecks, check(revised.version)]
  await capture('author', revised).submitForReview(sop.id, { reviewerIds: ['reviewer'], responseDueDate: fixedResponseDueDate() })
  return current()
}
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 23, 12) })
  fixture.users.splice(0, fixture.users.length, person('author', ['author']), person('coauthor', ['author']), person('reviewer', ['reviewer']), person('controller', ['approver']), person('other', ['author', 'approver']), person('admin', ['admin', 'author']))
  fixture.departments.splice(0, fixture.departments.length, { id: 'home', name: 'Home', initials: 'HM', description: '', qualityControllerId: 'controller', requiresComplianceCheck: true })
})
afterEach(() => vi.useRealTimers())

describe('deadline simulation requires a current assignment', () => {
  it('denies a former v1 Approver after v2 internal reviews restart without mutating deadlines or history', async () => {
    const sop = await restartedReview(), before = structuredClone(sop), store = capture('controller', sop)
    expect(sop.version).toBe('2')
    expect(sop.approvers).toEqual([])
    expect(isApprover(sop, 'controller')).toBe(true)
    expect(() => store.shiftDueDates(sop.id, 1)).toThrow(/assignment/)
    expect(current()).toEqual(before)
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it('does not let historical approval records authorize new approval decisions', async () => {
    const sop = await restartedReview(), before = structuredClone(sop), store = capture('controller', sop)
    const old = sop.approvalSubmissions![0]
    const stale = { version: old.version, approvalSubmissionId: old.id }
    expect(isApprover(sop, 'controller')).toBe(true)
    expect(() => store.approveAs(sop.id, 'controller', undefined, stale)).toThrow()
    expect(() => store.returnAsApprover(sop.id, 'controller', 'Return the new version', stale)).toThrow()
    expect(() => store.publishAs(sop.id, 'controller', stale)).toThrow()
    expect(current()).toEqual(before)
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it('allows a current v2 Approver to shift only the active approval deadline, preserving v1 history and original allocations', async () => {
    const revised = await restartedReview(), round = currentInternalRound(revised)!
    const accepted = acceptInternalReview(revised, 'reviewer', round.id, round.assignments[0].id, env())
    const completed = decideInternalReview(accepted, 'reviewer', round.id, round.assignments[0].id, 'completed', undefined, env())
    const sop = submitForApproval(completed, 'author', options(completed), env())
    const before = structuredClone(sop), store = capture('controller', sop)
    store.shiftDueDates(sop.id, 1)
    expect(current().approvalDueAt).toBe(new Date('2026-10-27T23:59:59.999').toISOString())
    expect(current().approvalSubmissions!.at(-1)).toMatchObject({ version: '2', dueDate: '2026-10-27', assignedDueDays: 5 })
    expect(current().approvalSubmissions![0]).toEqual(before.approvalSubmissions![0])
    expect(current().internalReviewRounds).toEqual(before.internalReviewRounds)
    expect(current().timeline).toEqual(before.timeline)
    expect(current().approvalDueDays).toBe(before.approvalDueDays)
  })

  it.each(['author', 'coauthor', 'reviewer'])('preserves authorized %s deadline simulation for the active internal round', async (actor) => {
    const sop = await restartedReview(), before = structuredClone(sop), store = capture(actor, sop)
    store.shiftDueDates(sop.id, 1)
    expect(currentInternalRound(current())).toMatchObject({ version: '2' })
    const previousDeadline = currentInternalRound(before)!.assignments[0].responseDueAt!
    const expectedDeadline = new Date(new Date(previousDeadline).getTime() - 24 * 60 * 60 * 1000).toISOString()
    expect(currentInternalRound(current())!.assignments[0]).toMatchObject({ responseDueAt: expectedDeadline, responseDueDate: expectedDeadline.slice(0, 10) })
    expect(current().internalReviewRounds![0]).toEqual(before.internalReviewRounds![0])
    expect(current().approvalSubmissions).toEqual(before.approvalSubmissions)
    expect(current().timeline).toEqual(before.timeline)
  })

  it('rejects stale modern approval assignments even when current status says In Approval', () => {
    const sop = submitted()
    sop.approvers[0].version = 'older'
    const before = structuredClone(sop), store = capture('controller', sop)
    expect(() => store.shiftDueDates(sop.id, 1)).toThrow(/assignment/)
    expect(current()).toEqual(before)
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it('does not let a completed Reviewer shift the current approval deadline', () => {
    const sop = submitted(), before = structuredClone(sop), store = capture('reviewer', sop)
    expect(() => store.shiftDueDates(sop.id, 1)).toThrow(/assignment/)
    expect(current()).toEqual(before)
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it.each(['author', 'reviewer', 'controller'])('still requires the active %s permission', async (actor) => {
    const sop = actor === 'controller' ? submitted() : await restartedReview()
    fixture.users.find((user) => user.id === actor)!.permissions = []
    const before = structuredClone(sop), store = capture(actor, sop)
    expect(() => store.shiftDueDates(sop.id, 1)).toThrow(/assignment/)
    expect(current()).toEqual(before)
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it.each(['reviewer', 'controller'])('preserves current legacy %s assignments without modern version metadata', (actor) => {
    const sop: Sop = {
      ...reviewed(), internalReviewRounds: undefined, status: actor === 'reviewer' ? 'in-review' : 'in-approval',
      reviewers: [{ userId: 'reviewer', decision: actor === 'reviewer' ? 'pending' : 'completed' }],
      approvers: [{ userId: 'controller', decision: 'pending' }],
      reviewDueAt: new Date('2026-10-28T23:59:59.999').toISOString(), approvalDueAt: new Date('2026-10-28T23:59:59.999').toISOString(),
    }
    capture(actor, sop).shiftDueDates(sop.id, 1)
    expect(current().approvalDueAt).toBe(new Date('2026-10-27T23:59:59.999').toISOString())
    expect(current().reviewDueAt).toBe(new Date('2026-10-27T23:59:59.999').toISOString())
  })

  it('does not authorize a legacy Approver before the approval stage starts', () => {
    const sop: Sop = { ...reviewed(), internalReviewRounds: undefined, reviewers: [{ userId: 'reviewer', decision: 'pending' }], approvers: [{ userId: 'controller', decision: 'pending' }] }
    const before = structuredClone(sop), store = capture('controller', sop)
    expect(() => store.shiftDueDates(sop.id, 1)).toThrow(/assignment/)
    expect(current()).toEqual(before)
    expect(fixture.commit).not.toHaveBeenCalled()
  })
})

describe('approval submission at the authenticated store boundary', () => {
  it('submits once as the main Author and preserves reviewed content, decisions and history', () => {
    const sop = reviewed(), before = structuredClone(sop), store = capture('author', sop)
    store.submitForApproval(sop.id, options(sop))
    expect(current()).toMatchObject({ status: 'in-approval', description: before.description, internalReviewRounds: before.internalReviewRounds, comments: before.comments })
    expect(current().approvers).toHaveLength(1)
    expect(current().approvers[0]).toMatchObject({ userId: 'controller', decision: 'pending', version: '1' })
    expect(current().timeline.slice(0, before.timeline.length)).toEqual(before.timeline)
    expect(current().timeline.find((event) => event.type === 'submitted-for-approval')).toMatchObject({ actorId: 'author', recipientIds: ['controller'] })
    expect(() => store.submitForApproval(sop.id, options(sop))).toThrow()
    expect(fixture.commit).toHaveBeenCalledTimes(1)
    expect(sop).toEqual(before)
  })

  it.each(['coauthor', 'reviewer', 'controller', 'other', 'admin', 'signed-out'])('denies %s even when they know the SOP and round IDs', (actor) => {
    const sop = reviewed(), before = structuredClone(sop), store = capture(actor, sop)
    expect(() => store.submitForApproval(sop.id, options(sop))).toThrow()
    expect(current()).toEqual(before)
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it.each(['deleted', 'missing-permission'])('denies a main Author whose account is %s', (condition) => {
    const sop = reviewed()
    if (condition === 'deleted') fixture.users[0].deletedAt = new Date().toISOString()
    else fixture.users[0].permissions = []
    expect(() => capture('author', sop).submitForApproval(sop.id, options(sop))).toThrow()
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it('rejects stale snapshots and missing attestations before committing', () => {
    const sop = reviewed(), store = capture('author', sop), valid = options(sop)
    for (const invalid of [{ ...valid, version: '0' }, { ...valid, internalReviewRoundId: 'old' }, { ...valid, noExternalReviewsRequired: false }, { ...valid, feedbackAddressed: false }]) {
      expect(() => store.submitForApproval(sop.id, invalid)).toThrow()
    }
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it('preserves external reviewer separation of duties when consuming Task 4 completion evidence', async () => {
    const external = { ...person('external', ['author', 'reviewer']), departmentId: 'other' }
    fixture.users.push(external)
    fixture.departments.push({ id: 'other', name: 'Other', initials: 'OT', description: '' })
    const sop = reviewed()
    sop.externalReviewGate = {
      version: sop.version, internalReviewRoundId: currentInternalRound(sop)!.id, requirement: 'required', departmentIds: ['other'],
      assignments: [{ id: 'external-review', departmentId: 'other', userId: external.id, version: sop.version, decision: 'completed', decidedAt: new Date().toISOString() }],
    }
    const author = capture('author', sop)
    author.submitForApproval(sop.id, { ...options(sop), noExternalReviewsRequired: false })
    expect(current().status).toBe('in-approval')
    await expect(author.addCoAuthors(sop.id, [external.id])).rejects.toThrow(/Reviewers and approvers cannot be co-authors/)
    expect(current().coAuthorIds).not.toContain(external.id)
  })
})

describe('assigned controller decisions at the store boundary', () => {
  it('requires the signed-in controller instead of a supplied actor ID', () => {
    const sop = submitted(), store = capture('other', sop)
    expect(() => store.approveAs(sop.id, 'controller', undefined, snapshot(sop))).toThrow()
    expect(() => store.returnAsApprover(sop.id, 'controller', 'Changes needed', snapshot(sop))).toThrow()
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it('requires an active Approver permission even with a valid assignment and snapshot', () => {
    const sop = submitted()
    fixture.users.find((user) => user.id === 'controller')!.permissions = []
    const store = capture('controller', sop)
    expect(() => store.approveAs(sop.id, 'controller', undefined, snapshot(sop))).toThrow()
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it('requires a current submission snapshot, then permits approval and a separate publication', () => {
    const sop = submitted(), store = capture('controller', sop), valid = snapshot(sop)
    for (const stale of [undefined, { ...valid, version: '0' }, { ...valid, approvalSubmissionId: 'old' }]) {
      expect(() => store.approveAs(sop.id, 'controller', undefined, stale)).toThrow()
    }
    expect(fixture.commit).not.toHaveBeenCalled()
    store.approveAs(sop.id, 'controller', 'Approved version one', valid)
    expect(current().status).toBe('approved')
    expect(current().approvalSubmissions?.at(-1)?.status).toBe('approved')
    expect(() => store.approveAs(sop.id, 'controller', undefined, valid)).toThrow()
    store.publishAs(sop.id, 'controller', valid)
    expect(current().status).toBe('published')
    expect(current().approvalSubmissions?.at(-1)?.status).toBe('published')
  })

  it('requires a reason for return and preserves the completed internal decisions', () => {
    const sop = submitted(), store = capture('controller', sop), valid = snapshot(sop)
    expect(() => store.returnAsApprover(sop.id, 'controller', '   ', valid)).toThrow()
    store.returnAsApprover(sop.id, 'controller', 'Revise the safety section', valid)
    expect(current().status).toBe('returned')
    expect(current().approvalSubmissions?.at(-1)?.status).toBe('returned')
    expect(current().internalReviewRounds).toEqual(sop.internalReviewRounds)
    expect(current().comments.at(-1)?.text).toBe('Revise the safety section')
    expect(() => store.publishAs(sop.id, 'controller', valid)).toThrow()
  })

  it('sends a revised and checked version to the chosen reviewers after an Approver return', async () => {
    const sop = submitted(), controller = capture('controller', sop)
    controller.returnAsApprover(sop.id, 'controller', 'Upload a revision', snapshot(sop))
    let returned = current()
    await expect(capture('author', returned).submitForReview(sop.id, { reviewerIds: ['reviewer'] })).rejects.toThrow(/new version/)
    expect(() => capture('author', returned).resubmit(sop.id)).toThrow(/Submit for review/)
    vi.advanceTimersByTime(1000)
    returned = uploadVersion(returned, 'author', { fileName: 'revised.pdf', fileType: 'pdf' })
    await expect(capture('author', returned).submitForReview(sop.id, { reviewerIds: ['reviewer'] })).rejects.toThrow(/compliance/)
    returned = { ...returned, complianceChecks: [...returned.complianceChecks, check(returned.version)] }
    const author = capture('author', returned)
    await author.submitForReview(sop.id, { reviewerIds: ['reviewer'] })
    expect(current()).toMatchObject({ status: 'in-review', version: '2', approvers: [] })
    expect(currentInternalRound(current())).toMatchObject({ status: 'open', version: '2' })
    expect(currentInternalRound(current())!.assignments.every((assignment) => assignment.decision === 'pending')).toBe(true)
    expect(current().approvalSubmissions).toEqual(returned.approvalSubmissions)
    expect(current().internalReviewRounds?.[0]).toEqual(returned.internalReviewRounds?.[0])
  })

  it('preserves separation of duties after a prior Approver assignment moves into history', async () => {
    fixture.users.find((user) => user.id === 'controller')!.permissions = ['author', 'reviewer', 'approver']
    const sop = submitted()
    const returned = returnAsApprover(sop, 'controller', 'Revise this version', snapshot(sop))
    vi.advanceTimersByTime(1000)
    const revised = uploadVersion(returned, 'author', { fileName: 'revised.pdf', fileType: 'pdf' })
    revised.complianceChecks = [...revised.complianceChecks, check(revised.version)]
    const author = capture('author', revised)
    await author.submitForReview(sop.id, { reviewerIds: ['reviewer'] })
    const round = currentInternalRound(current())!
    await author.removeInternalReviewer(sop.id, round.id, round.assignments[0].id, 'No longer needed')
    expect(current().status).toBe('in-review')
    expect(current().approvers).toEqual([])
    // The former approver can't be added as a reviewer of the same SOP.
    await expect(author.addInternalReviewers(sop.id, { reviewerIds: ['controller'] })).rejects.toThrow(/eligible reviewers/)
    await expect(author.addCoAuthors(sop.id, ['controller'])).rejects.toThrow(/approvers cannot be co-authors/)
  })
})

describe('automatic withdrawal at the store boundary', () => {
  function requested(): Sop {
    fixture.users.push(person('second', ['reviewer']))
    const draft: Sop = { id: 'test', code: 'TEST', title: 'Withdrawal fixture', version: '1', departmentId: 'home', authorId: 'author', coAuthorIds: [], status: 'draft', lastUpdated: '2026-10-23', fileName: 'test.pdf', fileType: 'pdf', versions: [{ version: '1', fileName: 'test.pdf', fileType: 'pdf', uploadedAt: new Date().toISOString() }], reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [check('1')] }
    const sop = startInternalReview(draft, 'author', '4.0', { reviewerIds: ['reviewer', 'second'], responseDueDate: fixedResponseDueDate() }, env())
    return acceptInternalReview(sop, 'second', currentInternalRound(sop)!.id, currentInternalRound(sop)!.assignments[1].id, env())
  }
  it('withdraws unanswered requests before the next action and refuses acting on them', async () => {
    const sop = requested()
    const responseDueAt = currentInternalRound(sop)!.assignments[0].responseDueAt!
    vi.setSystemTime(new Date(new Date(responseDueAt).getTime() + 1))
    await expect(capture('reviewer', sop).acceptInternalReview(sop.id, currentInternalRound(sop)!.id, currentInternalRound(sop)!.assignments[0].id)).rejects.toThrow(/withdrawn/)
    const round = currentInternalRound(sop)!
    await capture('second', sop).decideInternalReview(sop.id, round.id, round.assignments[1].id, 'completed', 'Fine')
    expect(currentInternalRound(current())!.assignments.map((assignment) => assignment.decision)).toEqual(['withdrawn', 'completed'])
    expect(current().timeline.find((event) => event.type === 'review-withdrawn')).toMatchObject({ createdAt: responseDueAt })
  })
})
