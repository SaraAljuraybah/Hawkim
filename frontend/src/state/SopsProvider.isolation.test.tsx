import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Department, Sop, User } from '../data/mock/types'
import { currentInternalRound, withdrawUnanswered } from '../lib/internalReview'
import { SopsProvider } from './SopsProvider'
import type { SopsStore } from './sopsContext'

type Slot = { initialized?: boolean; value?: unknown; dependencies?: unknown[]; cleanup?: () => void }
const fixture = vi.hoisted(() => ({
  useFetchMock: false,
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
vi.mock('../data/mock/sops', () => ({ sops: fixture.sops }))
vi.mock('./sessionContext', () => ({ useSession: () => ({ user: fixture.user }) }))
vi.mock('./usersContext', () => ({ useUsers: () => ({ users: fixture.people, getUser: (id: string) => fixture.people.find((user) => user.id === id) }) }))
vi.mock('./departmentsContext', () => ({ useDepartments: () => ({ departments: fixture.departments }) }))
vi.mock('./guidelinesContext', () => ({ useGuidelines: () => ({ currentGuideline: { name: 'GVP', version: '4.0' } }) }))
// These store tests use working-day request deadlines as they behave once activated (lib/deadlinePolicy.ts).
vi.mock('../lib/deadlinePolicy', () => ({ WORKING_DAY_DEADLINES_ACTIVE: true }))

/*
 * A stand-in for the database (no Supabase client, no network): each service applies the same
 * transition as the browser rules to its own copy, as the RPCs do, and reading returns only the
 * rows the signed-in user may read (visibleSops stands in for row level security).
 */
const backend = vi.hoisted(() => ({ rows: new Map<string, Sop>(), calls: [] as string[] }))
vi.mock('../services/sops', async () => {
  const { visibleSops } = await import('./visibleSops')
  const workflow = await import('../lib/workflow')
  const read = () => visibleSops([...backend.rows.values()].map((sop) => structuredClone(sop)), fixture.user, [])
  const change = (id: string, transition: (sop: Sop) => Sop) => { backend.rows.set(id, transition(backend.rows.get(id)!)) }
  return {
    fetchSops: vi.fn(async () => { backend.calls.push('fetchSops'); return fixture.useFetchMock ? fixture.fetchSops() : read() }),
    fetchSop: vi.fn(async (id: string) => { backend.calls.push('fetchSop'); return read().find((sop) => sop.id === id) ?? null }),
    createSop: vi.fn(async (input: { title: string; description?: string; departmentId: string; file: { storagePath: string; fileName: string; fileType: 'pdf' | 'docx' } }) => {
      backend.calls.push('createSop')
      const id = 'db-' + (backend.rows.size + 1)
      const now = new Date().toISOString()
      backend.rows.set(id, {
        id, code: 'SOP-00' + (backend.rows.size + 1), title: input.title, description: input.description, departmentId: input.departmentId,
        authorId: fixture.user!.id, coAuthorIds: [], status: 'draft', version: '1', lastUpdated: now.slice(0, 10),
        fileName: input.file.fileName, fileType: input.file.fileType, reviewers: [], approvers: [], comments: [], complianceChecks: [],
        versions: [{ version: '1', fileName: input.file.fileName, fileType: input.file.fileType, storagePath: input.file.storagePath, uploadedById: fixture.user!.id, uploadedAt: now }],
        timeline: [{ id: 'evt-' + id, type: 'version-uploaded', actorId: fixture.user!.id, version: '1', createdAt: now }],
      })
      return id
    }),
    uploadSopVersion: vi.fn(async (id: string, file: { fileName: string; fileType: 'pdf' | 'docx' }) => change(id, (sop) => workflow.uploadVersion(sop, fixture.user!.id, file))),
    deleteSopVersion: vi.fn(async (id: string, version: string) => change(id, (sop) => workflow.deleteVersion(sop, fixture.user!.id, version))),
    addCoAuthors: vi.fn(async (id: string, ids: string[]) => change(id, (sop) => workflow.addCoAuthors(sop, fixture.user!.id, ids))),
    removeCoAuthor: vi.fn(async (id: string, coAuthorId: string) => change(id, (sop) => workflow.removeCoAuthor(sop, fixture.user!.id, coAuthorId))),
  }
})
vi.mock('../services/review', async () => {
  const lib = await import('../lib/internalReview')
  const workflow = await import('../lib/workflow')
  const env = () => ({ users: fixture.people, departments: fixture.departments })
  const actor = () => fixture.user!.id
  const sopOfRequest = (requestId: string) => [...backend.rows.values()].find((sop) => sop.internalReviewRounds?.some((round) => round.assignments.some((task) => task.id === requestId)))!
  const roundOf = (sop: Sop, requestId: string) => sop.internalReviewRounds!.find((round) => round.assignments.some((task) => task.id === requestId))!.id
  const apply = (sop: Sop, transition: (sop: Sop) => Sop) => { backend.calls.push('review'); backend.rows.set(sop.id, transition(lib.withdrawUnanswered(sop))) }
  const onRequest = (requestId: string, transition: (sop: Sop, roundId: string) => Sop) => { const sop = sopOfRequest(requestId); apply(sop, (current) => transition(current, roundOf(sop, requestId))) }
  return {
    submitReview: async (id: string, o: Parameters<typeof lib.startInternalReview>[3]) => apply(backend.rows.get(id)!, (sop) => sop.status === 'draft'
      ? lib.startInternalReview(sop, actor(), '4.0', o, env()) : lib.sendNewVersionForReview(sop, actor(), '4.0', o, env())),
    addReviewers: async (id: string, o: Parameters<typeof lib.addInternalReviewers>[2]) => apply(backend.rows.get(id)!, (sop) => lib.addInternalReviewers(sop, actor(), o, env())),
    acceptReview: async (requestId: string) => onRequest(requestId, (sop, roundId) => lib.acceptInternalReview(sop, actor(), roundId, requestId, env())),
    declineReview: async (requestId: string, reason: string) => onRequest(requestId, (sop, roundId) => lib.declineInternalReview(sop, actor(), roundId, requestId, reason, env())),
    decideReview: async (requestId: string, decision: 'completed' | 'returned', text?: string) => onRequest(requestId, (sop, roundId) => lib.decideInternalReview(sop, actor(), roundId, requestId, decision, text, env())),
    removeReviewer: async (requestId: string, reason: string) => onRequest(requestId, (sop, roundId) => lib.removeInternalReviewer(sop, actor(), roundId, requestId, reason, env())),
    respondToComments: async (id: string, text: string) => apply(backend.rows.get(id)!, (sop) => workflow.addResponse(sop, actor(), text)),
    withdrawDueRequests: async (id: string) => apply(backend.rows.get(id)!, (sop) => sop),
  }
})
vi.mock('../services/files', async () => {
  const { fileTypeOf } = await import('../lib/prototypeFiles')
  return {
    uploadSopFile: vi.fn(async (userId: string, file: File) => {
      const fileType = fileTypeOf(file) // the real service refuses other types before uploading
      backend.calls.push('uploadSopFile')
      return { storagePath: `${userId}/${backend.calls.length}.${fileType}`, fileName: file.name, fileType, fileSize: file.size }
    }),
  }
})
vi.mock('../services/compliance', async () => {
  const compliance = await import('../lib/compliance')
  return {
    startComplianceCheck: vi.fn(async (id: string) => {
      backend.calls.push('startComplianceCheck')
      const started = compliance.startCheck(backend.rows.get(id)!, { name: 'GVP', version: '4.0' }, { manualBy: fixture.user!.id })
      backend.rows.set(id, started.sop)
      return started.checkId
    }),
    finishSampleCheck: vi.fn(async (checkId: string, outcome: 'completed' | 'failed') => {
      backend.calls.push('finishSampleCheck')
      const sop = [...backend.rows.values()].find((item) => item.complianceChecks.some((check) => check.id === checkId))!
      backend.rows.set(sop.id, outcome === 'failed' ? compliance.failCheck(sop, checkId) : compliance.completeCheck(sop, checkId))
    }),
  }
})

const person = (id: string, permissions: User['permissions']): User => ({ id, permissions, name: id, initials: 'TT', email: id + '@example.test', departmentId: 'home' })
const draft = (id: string, authorId: string): Sop => ({
  id, code: 'SOP-001', title: id, departmentId: 'home', authorId, coAuthorIds: [], status: 'draft', version: '1', lastUpdated: '2026-10-29', fileName: 'stored.pdf', fileType: 'pdf',
  versions: [{ version: '1', fileName: 'stored.pdf', fileType: 'pdf', storagePath: authorId + '/stored.pdf', uploadedAt: '2026-10-29T08:00:00Z' }], reviewers: [], approvers: [], comments: [], timeline: [],
  complianceChecks: [{ id: 'checked-' + id, sopId: id, version: '1', status: 'completed', startedAt: '2026-10-29T08:00:00Z', guideline: { name: 'GVP', version: '4.0' }, findings: [] }],
})
/** Puts SOPs in the stand-in database. */
const stored = (...sops: Sop[]) => { for (const sop of sops) backend.rows.set(sop.id, structuredClone(sop)) }
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
async function settle() {
  for (let round = 0; round < 3; round++) {
    await vi.dynamicImportSettled()
    for (let index = 0; index < 30; index++) await Promise.resolve()
  }
}
/** Signs `user` in (or out, with null) in this tab and waits for their SOPs to load from the database. */
async function signIn(user: User | null): Promise<SopsStore> {
  fixture.user = user
  render(); flushEffects(); await settle()
  return render()
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-29T09:00:00Z') })
  vi.stubGlobal('window', globalThis)
  fixture.useFetchMock = false
  fixture.people.splice(0, fixture.people.length, person('author', ['author']), person('reviewer', ['reviewer']), person('other', ['author']))
  fixture.departments.splice(0, fixture.departments.length, { id: 'home', name: 'Home', initials: 'HM', description: '', requiresComplianceCheck: true })
  fixture.user = fixture.people[0]
  fixture.sops.splice(0)
  fixture.slots = []
  fixture.effects = []
  fixture.layoutEffects = []
  fixture.fetchSops.mockReset()
  fixture.fetchSop.mockReset()
  backend.rows.clear()
  backend.calls.splice(0)
})
afterEach(() => {
  fixture.slots.forEach((slot) => slot.cleanup?.())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('identity isolation with the database services (stand-in database, no network)', () => {
  it('creates drafts through Storage and the create RPC, with the existing validation first', async () => {
    const store = await signIn(fixture.people[0])
    const input = { title: '  Stored SOP  ', description: 'First line\nSecond line', departmentId: 'home', file: new File(['%PDF'], 'stored.pdf', { type: 'application/pdf' }) }
    await expect(store.addDraft({ ...input, title: 'x'.repeat(51) })).rejects.toThrow(/1 to 50/)
    expect(backend.calls).not.toContain('uploadSopFile')
    await expect(store.addDraft({ ...input, file: new File(['text'], 'invalid.txt') })).rejects.toThrow(/PDF/)
    expect(backend.calls).not.toContain('createSop')
    const created = await store.addDraft(input)
    expect(created).toMatchObject({ title: 'Stored SOP', description: input.description, authorId: 'author', departmentId: 'home', status: 'draft' })
    expect(created.versions[0].storagePath).toMatch(/^author\//)
    expect(render().sops.map((sop) => sop.id)).toEqual([created.id])
    const before = render().sops[0]
    await expect(render().uploadVersion(created.id, new File(['text'], 'invalid.txt'))).rejects.toThrow(/PDF/)
    expect(render().sops[0]).toEqual(before)
    expect(backend.calls.filter((call) => call === 'uploadSopFile')).toHaveLength(1)
  })

  it('hides previous identity data immediately, does not carry database rows across users, and rejects stale callbacks', async () => {
    stored(draft('private', 'author'))
    const author = await signIn(fixture.people[0])
    expect(author.sops.map((sop) => sop.id)).toEqual(['private'])
    fixture.user = fixture.people[2]
    expect(render().sops).toEqual([])
    await expect(author.submitForReview('private', { reviewerIds: ['reviewer'] })).rejects.toThrow(/user changed/)
    expect(backend.calls).not.toContain('review')
    expect((await signIn(fixture.people[2])).sops).toEqual([])
    fixture.user = null
    expect(render().sops).toEqual([])
    expect((await signIn(fixture.people[0])).sops.map((sop) => sop.id)).toEqual(['private'])
  })

  it('runs Author to Reviewer decisions through the review RPCs and reads the saved result', async () => {
    stored(draft('shared', 'author'))
    await (await signIn(fixture.people[0])).submitForReview('shared', { reviewerIds: ['reviewer'], reviewDurationDays: 2 })
    let reviewer = await signIn(fixture.people[1])
    const round = currentInternalRound(reviewer.sops[0])!
    await reviewer.acceptInternalReview('shared', round.id, round.assignments[0].id)
    reviewer = render()
    await reviewer.decideInternalReview('shared', round.id, round.assignments[0].id, 'completed', 'Checked')
    const result = (await signIn(fixture.people[0])).sops[0]
    expect(currentInternalRound(result)!.assignments[0]).toMatchObject({ decision: 'completed' })
    expect(result.timeline.map((event) => event.type)).toEqual(['submitted', 'review-accepted', 'review-completed', 'internal-review-completed'])
    expect(currentInternalRound(backend.rows.get('shared')!)!.assignments[0].decision).toBe('completed')
  })

  it('runs parallel reviews in the database and keeps the separate Author approval handoff in this tab only', async () => {
    const second = person('second', ['reviewer'])
    const controller = person('controller', ['approver'])
    fixture.people.push(second, controller)
    fixture.departments[0].qualityControllerId = controller.id
    stored(draft('shared', 'author'), draft('author-private', 'author'), draft('other-private', 'other'))
    const author = await signIn(fixture.people[0])
    expect(author.sops.map((sop) => sop.id).sort()).toEqual(['author-private', 'shared'])
    await author.submitForReview('shared', { reviewerIds: ['reviewer', second.id], reviewDurationDays: 2 })
    const requested = render().sops.find((sop) => sop.id === 'shared')!
    const round = currentInternalRound(requested)!
    expect(round.assignments.map((assignment) => ({ userId: assignment.userId, decision: assignment.decision }))).toEqual([
      { userId: 'reviewer', decision: 'pending' }, { userId: second.id, decision: 'pending' },
    ])
    const options = { version: requested.version, internalReviewRoundId: round.id, noExternalReviewsRequired: true, feedbackAddressed: true }
    expect(() => render().submitForApproval('shared', options)).toThrow(/review/i)

    // Department configuration alone gives the controller no access.
    expect((await signIn(controller)).sops).toEqual([])
    expect(() => author.submitForApproval('shared', options)).toThrow(/user changed/)

    // The second Reviewer can finish first: these are independent parallel requests.
    let reviewer = await signIn(second)
    expect(reviewer.sops.map((sop) => sop.id)).toEqual(['shared'])
    await expect(reviewer.acceptInternalReview('shared', round.id, round.assignments[0].id)).rejects.toThrow(/assigned internal Reviewer/)
    await reviewer.acceptInternalReview('shared', round.id, round.assignments[1].id)
    reviewer = render()
    await reviewer.decideInternalReview('shared', round.id, round.assignments[1].id, 'completed', 'Second reviewer feedback')
    expect(currentInternalRound(render().sops[0])!.status).toBe('open')

    reviewer = await signIn(fixture.people[1])
    await expect(reviewer.decideInternalReview('shared', round.id, round.assignments[0].id, 'completed')).rejects.toThrow(/Accept the review/)
    await reviewer.acceptInternalReview('shared', round.id, round.assignments[0].id)
    reviewer = render()
    await reviewer.decideInternalReview('shared', round.id, round.assignments[0].id, 'completed', 'First reviewer feedback')
    expect(currentInternalRound(render().sops[0])!.status).toBe('completed')
    expect(() => render().submitForApproval('shared', options)).toThrow(/main Author/)

    let store = await signIn(fixture.people[0])
    const reviewed = store.sops.find((sop) => sop.id === 'shared')!
    expect(reviewed.status).toBe('in-review')
    expect(reviewed.approvers).toEqual([])
    expect(() => store.submitForApproval('shared', { ...options, feedbackAddressed: false })).toThrow(/feedback/)
    store.submitForApproval('shared', options)
    store = render()
    const submitted = store.sops.find((sop) => sop.id === 'shared')!
    expect(submitted.status).toBe('in-approval')
    expect(submitted.approvalSubmissions!.at(-1)).toMatchObject({ submittedById: 'author', approverId: controller.id, internalReviewRoundId: round.id, status: 'pending' })
    expect(submitted.internalReviewRounds).toEqual(reviewed.internalReviewRounds)
    // Approval is not in the database yet: the stored SOP is still In Review there.
    expect(backend.rows.get('shared')!.status).toBe('in-review')
    expect(backend.rows.get('shared')!.approvalSubmissions).toBeUndefined()
  })

  it('updates visible state exactly at response expiry without an action, leaving an accepted overdue review active', async () => {
    const second = person('second', ['reviewer'])
    fixture.people.push(second)
    stored(draft('expiring', 'author'))
    await (await signIn(fixture.people[0])).submitForReview('expiring', { reviewerIds: ['reviewer', second.id], reviewDurationDays: 1 })
    let store = await signIn(second)
    const round = currentInternalRound(store.sops[0])!
    await store.acceptInternalReview('expiring', round.id, round.assignments[1].id)
    const deadline = round.assignments[0].responseDueAt!
    expect(deadline).toBe('2026-11-02T20:59:59.999Z')
    store = await signIn(fixture.people[0])
    const accepted = currentInternalRound(store.sops[0])!.assignments[1]
    // Resume the tab just before the saved expiry so the provider installs its final timer.
    vi.setSystemTime(Date.parse(deadline) - 1000)
    store = render()
    flushEffects()
    expect(Date.parse(accepted.reviewDueAt!)).toBeLessThan(Date.now())
    await vi.advanceTimersByTimeAsync(999)
    expect(currentInternalRound(render().sops[0])!.assignments.map((assignment) => assignment.decision)).toEqual(['pending', 'accepted'])
    // At the deadline the database is asked to withdraw (withdraw_due_requests), then the SOP is read again.
    backend.rows.set('expiring', withdrawUnanswered(backend.rows.get('expiring')!, Date.parse(deadline) + 1))
    await vi.advanceTimersByTimeAsync(1); await settle()
    const expired = render().sops[0]
    expect(expired.status).toBe('in-review')
    expect(currentInternalRound(expired)!.assignments).toEqual([
      expect.objectContaining({ id: round.assignments[0].id, decision: 'withdrawn', withdrawnAt: deadline }), accepted,
    ])
    expect(expired.timeline.filter((event) => event.type === 'review-withdrawn')).toEqual([
      expect.objectContaining({ actorId: 'system', reviewAssignmentId: round.assignments[0].id, createdAt: deadline }),
    ])
    store = await signIn(fixture.people[1])
    expect(currentInternalRound(store.sops[0])!.assignments[0].decision).toBe('withdrawn')
    await expect(store.acceptInternalReview('expiring', round.id, round.assignments[0].id)).rejects.toThrow(/withdrawn/)
  })

  it('does not permit a Reviewer to independently add or route reviewers', async () => {
    stored(draft('shared', 'author'))
    await (await signIn(fixture.people[0])).submitForReview('shared', { reviewerIds: ['reviewer'] })
    const store = await signIn(fixture.people[1])
    const calls = backend.calls.length
    await expect(store.addInternalReviewers('shared', { reviewerIds: ['other'] })).rejects.toThrow(/Author/)
    expect(() => store.routeToReviewer('shared', 'reviewer', 'other')).toThrow(/Author/)
    expect(() => store.reviewAction('shared', { type: 'forward', reviewerId: 'other' })).toThrow(/Author/)
    expect(() => store.reviewAction('shared', { type: 'skip', scope: 'same-division' })).toThrow(/Author/)
    expect(() => store.reviewAction('shared', { type: 'quality' })).toThrow(/Author/)
    expect(() => store.reviewAction('shared', { type: 'department-review', scope: 'same-division', assignments: [] })).toThrow(/Author/)
    expect(backend.calls.slice(calls).filter((call) => call === 'review')).toEqual([])
    expect(currentInternalRound(render().sops[0])!.assignments).toHaveLength(1)
  })

  it('preserves a legacy (sample) handoff to a reviewer already assigned by the Author without changing their deadline', async () => {
    fixture.people.push(person('second', ['reviewer']))
    const legacy: Sop = {
      ...draft('legacy', 'author'), status: 'in-review',
      reviewers: [{ userId: 'reviewer', decision: 'pending' }, { userId: 'second', decision: 'pending', dueDate: '2026-11-05', assignedDueDays: 7 }],
      reviewFlow: { stage: 'reviewer-1', reviewer1Id: 'reviewer', reviewer2Id: 'second', activeReviewerId: 'reviewer', sameDivision: 'pending', crossDivision: 'pending', departments: [] },
    }
    fixture.sops.push(legacy)
    const store = await signIn(fixture.people[1])
    expect(() => store.reviewAction('legacy', { type: 'forward', reviewerId: 'second', dueDate: '2026-11-06' })).toThrow(/without a new deadline/)
    store.reviewAction('legacy', { type: 'forward', reviewerId: 'second' })
    const result = render().sops.find((sop) => sop.id === 'legacy')!
    expect(result.reviewFlow).toMatchObject({ stage: 'reviewer-2', activeReviewerId: 'second' })
    expect(result.reviewers.find((person) => person.userId === 'second')).toMatchObject({ dueDate: '2026-11-05', assignedDueDays: 7 })
    expect(result.reviewers).toHaveLength(2)
  })

  it('rejects stale decisions from a projected historical request against the actual current round', async () => {
    const historical: Sop = {
      ...draft('versioned', 'author'), status: 'in-review', version: '2',
      versions: [...draft('versioned', 'author').versions, { version: '2', fileName: 'private-v2.pdf', fileType: 'pdf', storagePath: 'author/private-v2.pdf', uploadedAt: '2026-10-29T09:00:00Z' }],
      internalReviewRounds: [
        { id: 'old', scope: 'internal', version: '1', status: 'open', requestedById: 'author', requestedAt: '2026-10-20T09:00:00Z', assignedDueDays: null, assignments: [{ id: 'old-task', userId: 'reviewer', decision: 'pending', assignedAt: '2026-10-20T09:00:00Z' }] },
        { id: 'current', scope: 'internal', version: '2', status: 'open', requestedById: 'author', requestedAt: '2026-10-29T09:00:00Z', assignedDueDays: null, assignments: [{ id: 'new-task', userId: 'other', decision: 'pending', assignedAt: '2026-10-29T09:00:00Z' }] },
      ],
    }
    stored(historical)
    const reviewer = await signIn(fixture.people[1])
    expect(reviewer.sops[0].version).toBe('1')
    // The reviewer's rows show only the version sent to them; the database (here the stand-in) is the
    // authority on the current round and refuses the stale request, and the browser refuses the decision.
    await expect(reviewer.acceptInternalReview('versioned', 'old', 'old-task')).rejects.toThrow(/no longer open/)
    await expect(reviewer.decideInternalReview('versioned', 'old', 'old-task', 'completed')).rejects.toThrow()
    expect(backend.rows.get('versioned')).toEqual(historical)
  })

  it.each([false, true])('finishes the sample compliance check in the database and does not apply it after a user switch (failed: %s)', async (fail) => {
    stored({ ...draft('private-check', 'author'), complianceChecks: [] })
    const author = await signIn(fixture.people[0])
    if (fail) author.setFailNextCheck(true)
    await author.runCheck('private-check')
    expect(render().sops[0].complianceChecks.at(-1)!.status).toBe('running')
    await vi.advanceTimersByTimeAsync(3000); await settle()
    expect(render().sops[0].complianceChecks.at(-1)!.status).toBe(fail ? 'failed' : 'completed')
    expect(backend.rows.get('private-check')!.complianceChecks.at(-1)!.status).toBe(fail ? 'failed' : 'completed')

    // A check started by one user is not finished from this tab once someone else signs in.
    const again = await signIn(fixture.people[0])
    await again.runCheck('private-check')
    fixture.user = fixture.people[2]
    expect(render().sops).toEqual([])
    await vi.advanceTimersByTimeAsync(3000); await settle()
    expect(backend.rows.get('private-check')!.complianceChecks.at(-1)!.status).toBe('running')
  })
})

describe('database row cache isolation between users (mocked services only)', () => {
  it('clears previously loaded rows before the next identity response', async () => {
    fixture.useFetchMock = true
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
    fixture.useFetchMock = true
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
