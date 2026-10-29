import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Department, Sop, User } from '../data/mock/types'
import { currentInternalRound } from '../lib/internalReview'
import { SopsProvider } from './SopsProvider'
import type { SopsStore } from './sopsContext'

type Slot = { initialized?: boolean; value?: unknown; dependencies?: unknown[]; cleanup?: () => void }
const fixture = vi.hoisted(() => ({
  prototype: true,
  user: null as User | null,
  people: [] as User[],
  departments: [] as Department[],
  sops: [] as Sop[],
  slots: [] as Slot[],
  index: 0,
  effects: [] as (() => void)[],
  layoutEffects: [] as (() => void)[],
  fetchSops: vi.fn<() => Promise<Sop[]>>(),
  fetchSop: vi.fn<(id: string) => Promise<Sop | null>>(),
  serviceLoaded: vi.fn(),
}))

// A deterministic hook host lets the production provider survive identity switches
// and asynchronous replies without installing a DOM/test framework dependency.
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>()
  const slot = () => fixture.slots[fixture.index++] ?? (fixture.slots[fixture.index - 1] = {})
  const memo = (calculate: () => unknown, dependencies: unknown[]) => {
    const item = slot()
    if (!item.dependencies || !dependencies.every((value, index) => Object.is(value, item.dependencies![index]))) {
      item.value = calculate()
      item.dependencies = dependencies
    }
    return item.value
  }
  return {
    ...react,
    useState: (initial: unknown) => {
      const item = slot()
      if (!item.initialized) {
        item.initialized = true
        item.value = typeof initial === 'function' ? initial() : initial
      }
      return [item.value, (next: unknown) => { item.value = typeof next === 'function' ? next(item.value) : next }]
    },
    useRef: (initial: unknown) => {
      const item = slot()
      if (!item.initialized) { item.initialized = true; item.value = { current: initial } }
      return item.value
    },
    useMemo: memo,
    useCallback: (callback: unknown, dependencies: unknown[]) => memo(() => callback, dependencies),
    useContext: () => ({ requests: [] }),
    useLayoutEffect: (create: () => void | (() => void), dependencies: unknown[]) => {
      const item = slot()
      if (item.dependencies && dependencies.every((value, index) => Object.is(value, item.dependencies![index]))) return
      item.dependencies = dependencies
      fixture.layoutEffects.push(() => { item.cleanup?.(); item.cleanup = create() ?? undefined })
    },
    useEffect: (create: () => void | (() => void), dependencies: unknown[]) => {
      const item = slot()
      if (item.dependencies && dependencies.every((value, index) => Object.is(value, item.dependencies![index]))) return
      item.dependencies = dependencies
      fixture.effects.push(() => { item.cleanup?.(); item.cleanup = create() ?? undefined })
    },
  }
})
vi.mock('../lib/frontendRuntime', () => ({ get FRONTEND_PROTOTYPE() { return fixture.prototype } }))
vi.mock('../data/mock/sops', () => ({ sops: fixture.sops }))
vi.mock('./sessionContext', () => ({ useSession: () => ({ user: fixture.user }) }))
vi.mock('./usersContext', () => ({ useUsers: () => ({ users: fixture.people, getUser: (id: string) => fixture.people.find((user) => user.id === id) }) }))
vi.mock('./departmentsContext', () => ({ useDepartments: () => ({ departments: fixture.departments }) }))
vi.mock('./guidelinesContext', () => ({ useGuidelines: () => ({ currentGuideline: { name: 'GVP', version: '4.0' } }) }))
vi.mock('../services/sops', () => { fixture.serviceLoaded(); return { fetchSops: fixture.fetchSops, fetchSop: fixture.fetchSop } })
vi.mock('../services/review', () => { throw new Error('Prototype must not import experimental review services') })
vi.mock('../services/files', () => { throw new Error('Prototype must not import experimental storage services') })
vi.mock('../services/compliance', () => { throw new Error('Prototype must not import experimental compliance services') })

const person = (id: string, permissions: User['permissions']): User => ({ id, permissions, name: id, initials: 'TT', email: id + '@example.test', departmentId: 'home' })
const draft = (id: string, authorId: string): Sop => ({
  id, code: 'SOP-001', title: id, departmentId: 'home', authorId, coAuthorIds: [], status: 'draft', version: '1', lastUpdated: '2026-10-29', fileName: 'local.pdf', fileType: 'pdf', fileUrl: '/local.pdf',
  versions: [{ version: '1', fileName: 'local.pdf', fileType: 'pdf', fileUrl: '/local.pdf', uploadedAt: '2026-10-29T08:00:00Z' }], reviewers: [], approvers: [], comments: [], timeline: [],
  complianceChecks: [{ id: 'checked-' + id, sopId: id, version: '1', status: 'completed', startedAt: '2026-10-29T08:00:00Z', guideline: { name: 'GVP', version: '4.0' }, findings: [] }],
})
function render(): SopsStore {
  fixture.index = 0
  const store = SopsProvider({ children: null }).props.value as SopsStore
  fixture.layoutEffects.splice(0).forEach((run) => run())
  return store
}
function flushEffects() {
  const pending = fixture.effects.splice(0)
  pending.forEach((run) => run())
}
async function settle() { for (let index = 0; index < 15; index++) await Promise.resolve() }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-29T09:00:00Z') })
  vi.stubGlobal('window', globalThis)
  fixture.prototype = true
  fixture.people.splice(0, fixture.people.length, person('author', ['author']), person('reviewer', ['reviewer']), person('other', ['author']))
  fixture.departments.splice(0, fixture.departments.length, { id: 'home', name: 'Home', initials: 'HM', description: '', requiresComplianceCheck: true })
  fixture.user = fixture.people[0]
  fixture.sops.splice(0)
  fixture.slots = []
  fixture.effects = []
  fixture.layoutEffects = []
  fixture.fetchSops.mockReset()
  fixture.fetchSop.mockReset()
  fixture.serviceLoaded.mockClear()
})
afterEach(() => {
  fixture.slots.forEach((slot) => slot.cleanup?.())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('local prototype identity isolation', () => {
  it('creates local file-backed drafts with existing validation and never imports storage services', async () => {
    const store = render()
    const input = { title: '  Local SOP  ', description: 'First line\nSecond line', departmentId: 'home', file: new File(['%PDF'], 'local.pdf', { type: 'application/pdf' }) }
    await expect(store.addDraft({ ...input, title: 'x'.repeat(51) })).rejects.toThrow(/1 to 50/)
    await expect(store.addDraft({ ...input, file: new File(['text'], 'invalid.txt') })).rejects.toThrow(/PDF/)
    const created = await store.addDraft(input)
    expect(created).toMatchObject({ title: 'Local SOP', description: input.description, authorId: 'author', departmentId: 'home', status: 'draft' })
    expect(created.fileUrl).toMatch(/^blob:/)
    expect(render().sops.map((sop) => sop.id)).toEqual([created.id])
    const before = render().sops[0]
    await expect(render().uploadVersion(created.id, new File(['text'], 'invalid.txt'))).rejects.toThrow(/PDF/)
    expect(render().sops[0]).toEqual(before)
    expect(fixture.serviceLoaded).not.toHaveBeenCalled()
    URL.revokeObjectURL(created.fileUrl!)
  })

  it('hides previous identity data immediately, preserves the shared workspace, and rejects stale callbacks', async () => {
    fixture.sops.push(draft('private', 'author'))
    const author = render()
    flushEffects(); await settle()
    expect(author.sops.map((sop) => sop.id)).toEqual(['private'])
    fixture.user = fixture.people[2]
    expect(render().sops).toEqual([])
    await expect(author.submitForReview('private', { reviewerIds: ['reviewer'] })).rejects.toThrow(/user changed/)
    fixture.user = null
    expect(render().sops).toEqual([])
    fixture.user = fixture.people[0]
    expect(render().sops.map((sop) => sop.id)).toEqual(['private'])
    expect(fixture.fetchSops).not.toHaveBeenCalled()
    expect(fixture.serviceLoaded).not.toHaveBeenCalled()
  })

  it('runs Author to Reviewer decisions locally without importing experimental services', async () => {
    fixture.sops.push(draft('shared', 'author'))
    await render().submitForReview('shared', { reviewerIds: ['reviewer'], reviewDurationDays: 2 })
    fixture.user = fixture.people[1]
    let reviewer = render()
    const round = currentInternalRound(reviewer.sops[0])!
    await reviewer.acceptInternalReview('shared', round.id, round.assignments[0].id)
    reviewer = render()
    await reviewer.decideInternalReview('shared', round.id, round.assignments[0].id, 'completed', 'Checked in the local prototype')
    fixture.user = fixture.people[0]
    const result = render().sops[0]
    expect(currentInternalRound(result)!.assignments[0]).toMatchObject({ decision: 'completed' })
    expect(result.timeline.map((event) => event.type)).toEqual(['submitted', 'review-accepted', 'review-completed', 'internal-review-completed'])
    expect(fixture.serviceLoaded).not.toHaveBeenCalled()
    expect(fixture.fetchSops).not.toHaveBeenCalled()
  })

  it('runs parallel review, the separate Author approval handoff, and Approver publication in one isolated local workspace', async () => {
    const second = person('second', ['reviewer'])
    const controller = person('controller', ['approver'])
    fixture.people.push(second, controller)
    fixture.departments[0].qualityControllerId = controller.id
    fixture.sops.push(draft('shared', 'author'), draft('author-private', 'author'), draft('other-private', 'other'))
    const author = render()
    expect(author.sops.map((sop) => sop.id)).toEqual(['shared', 'author-private'])
    await author.submitForReview('shared', { reviewerIds: ['reviewer', second.id], reviewDurationDays: 2 })
    const requested = render().sops.find((sop) => sop.id === 'shared')!
    const round = currentInternalRound(requested)!
    expect(round.assignments.map((assignment) => ({ userId: assignment.userId, decision: assignment.decision }))).toEqual([
      { userId: 'reviewer', decision: 'pending' }, { userId: second.id, decision: 'pending' },
    ])
    expect(requested.approvers).toEqual([])
    const options = { version: requested.version, internalReviewRoundId: round.id, noExternalReviewsRequired: true, feedbackAddressed: true }
    expect(() => render().submitForApproval('shared', options)).toThrow(/review/i)

    // Department configuration alone gives the controller no access or ability to act.
    fixture.user = controller
    expect(render().sops).toEqual([])
    expect(() => author.submitForApproval('shared', options)).toThrow(/user changed/)

    // The second Reviewer can finish first: these are independent parallel requests.
    fixture.user = second
    let reviewer = render()
    expect(reviewer.sops.map((sop) => sop.id)).toEqual(['shared'])
    await expect(reviewer.acceptInternalReview('shared', round.id, round.assignments[0].id)).rejects.toThrow(/assigned internal Reviewer/)
    await reviewer.acceptInternalReview('shared', round.id, round.assignments[1].id)
    reviewer = render()
    await reviewer.decideInternalReview('shared', round.id, round.assignments[1].id, 'completed', 'Second reviewer feedback')
    expect(currentInternalRound(render().sops[0])!.status).toBe('open')

    fixture.user = fixture.people[1]
    reviewer = render()
    expect(reviewer.sops.map((sop) => sop.id)).toEqual(['shared'])
    await expect(reviewer.decideInternalReview('shared', round.id, round.assignments[0].id, 'completed')).rejects.toThrow(/Accept the review/)
    await reviewer.acceptInternalReview('shared', round.id, round.assignments[0].id)
    reviewer = render()
    await reviewer.decideInternalReview('shared', round.id, round.assignments[0].id, 'completed', 'First reviewer feedback')
    const completed = render().sops[0]
    expect(completed.status).toBe('in-review')
    expect(currentInternalRound(completed)!.status).toBe('completed')
    expect(completed.approvers).toEqual([])
    expect(completed.approvalSubmissions).toBeUndefined()
    expect(() => render().submitForApproval('shared', options)).toThrow(/main Author/)

    fixture.user = fixture.people[0]
    let store = render()
    const reviewed = store.sops.find((sop) => sop.id === 'shared')!
    const history = { rounds: structuredClone(reviewed.internalReviewRounds), comments: structuredClone(reviewed.comments), timeline: structuredClone(reviewed.timeline), versions: structuredClone(reviewed.versions) }
    expect(() => store.submitForApproval('shared', { ...options, feedbackAddressed: false })).toThrow(/feedback/)
    store.submitForApproval('shared', options)
    store = render()
    const submitted = store.sops.find((sop) => sop.id === 'shared')!
    const submission = submitted.approvalSubmissions!.at(-1)!
    const snapshot = { version: submitted.version, approvalSubmissionId: submission.id }
    expect(submitted.status).toBe('in-approval')
    expect(submitted.approvers).toEqual([expect.objectContaining({ userId: controller.id, decision: 'pending' })])
    expect(submission).toMatchObject({ submittedById: 'author', approverId: controller.id, internalReviewRoundId: round.id, status: 'pending' })
    expect(() => store.approveAs('shared', controller.id, undefined, snapshot)).toThrow(/signed-in assigned approver/)

    fixture.user = fixture.people[1]
    store = render()
    expect(() => store.approveAs('shared', controller.id, undefined, snapshot)).toThrow(/signed-in assigned approver/)
    fixture.user = controller
    store = render()
    expect(store.sops.map((sop) => sop.id)).toEqual(['shared'])
    expect(store.sops[0].internalReviewRounds).toEqual(history.rounds)
    expect(() => store.approveAs('shared', controller.id, undefined, { ...snapshot, approvalSubmissionId: 'former-request' })).toThrow(/stale/)
    store.approveAs('shared', controller.id, 'Ready to publish', snapshot)
    store = render()
    expect(store.sops[0].status).toBe('approved')
    expect(store.sops[0].approvalSubmissions).toEqual([expect.objectContaining({ id: submission.id, status: 'approved' })])
    store.publishAs('shared', controller.id, snapshot)

    fixture.user = null
    expect(render().sops).toEqual([])
    fixture.user = fixture.people[0]
    const published = render().sops.find((sop) => sop.id === 'shared')!
    expect(published.status).toBe('published')
    expect(published.internalReviewRounds).toEqual(history.rounds)
    expect(published.versions).toEqual(history.versions)
    expect(published.comments.slice(0, history.comments.length)).toEqual(history.comments)
    expect(published.timeline.slice(0, history.timeline.length)).toEqual(history.timeline)
    expect(published.approvalSubmissions).toEqual([expect.objectContaining({ id: submission.id, status: 'published' })])
    expect(published.timeline.slice(-5).map((event) => event.type)).toEqual(['external-reviews-not-required', 'submitted-for-approval', 'approved-by', 'approved', 'published'])
    expect(fixture.serviceLoaded).not.toHaveBeenCalled()
    expect(fixture.fetchSops).not.toHaveBeenCalled()
    expect(fixture.fetchSop).not.toHaveBeenCalled()
  })

  it('updates visible local state exactly at response expiry without an action, leaving an accepted overdue review active', async () => {
    const second = person('second', ['reviewer'])
    fixture.people.push(second)
    fixture.sops.push(draft('expiring', 'author'))
    await render().submitForReview('expiring', { reviewerIds: ['reviewer', second.id], reviewDurationDays: 1 })
    fixture.user = second
    let store = render()
    const round = currentInternalRound(store.sops[0])!
    await store.acceptInternalReview('expiring', round.id, round.assignments[1].id)
    const deadline = round.assignments[0].responseDueAt!
    expect(deadline).toBe('2026-11-02T20:59:59.999Z')
    fixture.user = fixture.people[0]
    // Resume the tab just before the saved expiry so the provider installs its final timer.
    vi.setSystemTime(Date.parse(deadline) - 1000)
    store = render()
    flushEffects()
    const accepted = currentInternalRound(store.sops[0])!.assignments[1]
    expect(Date.parse(accepted.reviewDueAt!)).toBeLessThan(Date.now())
    await vi.advanceTimersByTimeAsync(999)
    expect(currentInternalRound(render().sops[0])!.assignments.map((assignment) => assignment.decision)).toEqual(['pending', 'accepted'])
    await vi.advanceTimersByTimeAsync(1)
    const expired = render().sops[0]
    expect(expired.status).toBe('in-review')
    expect(currentInternalRound(expired)!.status).toBe('open')
    expect(currentInternalRound(expired)!.assignments).toEqual([
      expect.objectContaining({ id: round.assignments[0].id, decision: 'withdrawn', withdrawnAt: deadline }), accepted,
    ])
    expect(expired.reviewers.map((assignment) => assignment.decision)).toEqual(['cancelled', 'pending'])
    expect(expired.timeline.filter((event) => event.type === 'review-withdrawn')).toEqual([
      expect.objectContaining({ actorId: 'system', reviewAssignmentId: round.assignments[0].id, createdAt: deadline, recipientIds: ['author', 'reviewer'] }),
    ])
    expect(expired.approvers).toEqual([])
    fixture.user = fixture.people[1]
    store = render()
    expect(currentInternalRound(store.sops[0])!.assignments[0].decision).toBe('withdrawn')
    await expect(store.acceptInternalReview('expiring', round.id, round.assignments[0].id)).rejects.toThrow(/withdrawn/)
    expect(fixture.serviceLoaded).not.toHaveBeenCalled()
    expect(fixture.fetchSops).not.toHaveBeenCalled()
    expect(fixture.fetchSop).not.toHaveBeenCalled()
  })

  it('does not permit a Reviewer to independently add or route reviewers', async () => {
    fixture.sops.push(draft('shared', 'author'))
    await render().submitForReview('shared', { reviewerIds: ['reviewer'] })
    fixture.user = fixture.people[1]
    const store = render()
    await expect(store.addInternalReviewers('shared', { reviewerIds: ['other'] })).rejects.toThrow(/Author/)
    expect(() => store.routeToReviewer('shared', 'reviewer', 'other')).toThrow(/Author/)
    expect(() => store.reviewAction('shared', { type: 'forward', reviewerId: 'other' })).toThrow(/Author/)
    expect(() => store.reviewAction('shared', { type: 'skip', scope: 'same-division' })).toThrow(/Author/)
    expect(() => store.reviewAction('shared', { type: 'quality' })).toThrow(/Author/)
    expect(() => store.reviewAction('shared', { type: 'department-review', scope: 'same-division', assignments: [] })).toThrow(/Author/)
    expect(currentInternalRound(render().sops[0])!.assignments).toHaveLength(1)
  })

  it('preserves a legacy handoff to a reviewer already assigned by the Author without changing their deadline', () => {
    fixture.people.push(person('second', ['reviewer']))
    const legacy: Sop = {
      ...draft('legacy', 'author'), status: 'in-review',
      reviewers: [{ userId: 'reviewer', decision: 'pending' }, { userId: 'second', decision: 'pending', dueDate: '2026-11-05', assignedDueDays: 7 }],
      reviewFlow: { stage: 'reviewer-1', reviewer1Id: 'reviewer', reviewer2Id: 'second', activeReviewerId: 'reviewer', sameDivision: 'pending', crossDivision: 'pending', departments: [] },
    }
    fixture.sops.push(legacy)
    fixture.user = fixture.people[1]
    const store = render()
    expect(() => store.reviewAction('legacy', { type: 'forward', reviewerId: 'second', dueDate: '2026-11-06' })).toThrow(/without a new deadline/)
    store.reviewAction('legacy', { type: 'forward', reviewerId: 'second' })
    const result = render().sops[0]
    expect(result.reviewFlow).toMatchObject({ stage: 'reviewer-2', activeReviewerId: 'second' })
    expect(result.reviewers.find((person) => person.userId === 'second')).toMatchObject({ dueDate: '2026-11-05', assignedDueDays: 7 })
    expect(result.reviewers).toHaveLength(2)
  })

  it('rejects stale decisions from a projected historical request against the actual current workspace round', async () => {
    const historical: Sop = {
      ...draft('versioned', 'author'), status: 'in-review', version: '2',
      versions: [...draft('versioned', 'author').versions, { version: '2', fileName: 'private-v2.pdf', fileType: 'pdf', fileUrl: '/private-v2.pdf', uploadedAt: '2026-10-29T09:00:00Z' }],
      internalReviewRounds: [
        { id: 'old', scope: 'internal', version: '1', status: 'open', requestedById: 'author', requestedAt: '2026-10-20T09:00:00Z', assignedDueDays: null, assignments: [{ id: 'old-task', userId: 'reviewer', decision: 'pending', assignedAt: '2026-10-20T09:00:00Z' }] },
        { id: 'current', scope: 'internal', version: '2', status: 'open', requestedById: 'author', requestedAt: '2026-10-29T09:00:00Z', assignedDueDays: null, assignments: [{ id: 'new-task', userId: 'other', decision: 'pending', assignedAt: '2026-10-29T09:00:00Z' }] },
      ],
    }
    fixture.sops.push(historical)
    fixture.user = fixture.people[1]
    const reviewer = render()
    expect(reviewer.sops[0].version).toBe('1')
    await expect(reviewer.acceptInternalReview('versioned', 'old', 'old-task')).rejects.toThrow(/no longer open/)
    await expect(reviewer.decideInternalReview('versioned', 'old', 'old-task', 'completed')).rejects.toThrow(/no longer open/)
    fixture.user = fixture.people[0]
    expect(render().sops[0]).toEqual(historical)
  })

  it.each([false, true])('finishes an authorized local check after sign-out without exposing the document (failed: %s)', async (fail) => {
    fixture.sops.push(draft('private-check', 'author'))
    const author = render()
    if (fail) author.setFailNextCheck(true)
    await author.runCheck('private-check')
    expect(render().sops[0].complianceChecks.at(-1)!.status).toBe('running')
    fixture.user = null
    expect(render().sops).toEqual([])
    await vi.advanceTimersByTimeAsync(3000)
    fixture.user = fixture.people[2]
    expect(render().sops).toEqual([])
    fixture.user = fixture.people[0]
    const check = render().sops[0].complianceChecks.at(-1)!
    expect(check.status).toBe(fail ? 'failed' : 'completed')
    expect(fixture.serviceLoaded).not.toHaveBeenCalled()
  })
})

describe('disabled experimental adapter cache isolation (mocked services only)', () => {
  it('clears previously loaded rows before the next identity response', async () => {
    fixture.prototype = false
    const first = deferred<Sop[]>(), second = deferred<Sop[]>()
    fixture.fetchSops.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(); flushEffects(); await settle()
    first.resolve([draft('a-private', 'author')]); await settle()
    expect(render().sops.map((sop) => sop.id)).toEqual(['a-private'])
    // A fetched record changes between accounts; no old copy is merged into B.
    fixture.user = fixture.people[2]
    const next = render()
    expect(next.sops).toEqual([])
    expect(next.status).toBe('loading')
    flushEffects(); await settle()
    second.resolve([draft('b-private', 'other')]); await settle()
    expect(render().sops.map((sop) => sop.id)).toEqual(['b-private'])
    fixture.user = null
    expect(render().sops).toEqual([])
    flushEffects()
  })

  it('ignores a former identity fetch that completes after a new user has signed in', async () => {
    fixture.prototype = false
    const first = deferred<Sop[]>(), second = deferred<Sop[]>()
    fixture.fetchSops.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(); flushEffects(); await settle()
    fixture.user = fixture.people[2]
    render(); flushEffects(); await settle()
    second.resolve([draft('b-private', 'other')]); await settle()
    first.resolve([draft('a-private', 'author')]); await settle()
    expect(render().sops.map((sop) => sop.id)).toEqual(['b-private'])
    expect(render().status).toBe('ready')
  })
})
