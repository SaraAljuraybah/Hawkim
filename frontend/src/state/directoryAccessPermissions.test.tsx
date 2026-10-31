import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Department, Sop, User, UserRequest } from '../data/mock/types'
import { getDirectoryDepartments } from '../lib/departments'
import { SopsProvider } from './SopsProvider'
import { useSops, type NewDraft, type SopsStore } from './sopsContext'


const fixture = vi.hoisted(() => ({ userId: 'visitor', users: [] as User[], departments: [] as Department[], sops: [] as Sop[] }))
vi.mock('../data/mock/sops', () => ({ sops: fixture.sops }))
vi.mock('./sessionContext', () => ({ useSession: () => ({ user: fixture.users.find((user) => user.id === fixture.userId) ?? null }) }))
vi.mock('./usersContext', () => ({ useUsers: () => ({ users: fixture.users, getUser: (id: string) => fixture.users.find((user) => user.id === id) }) }))
vi.mock('./departmentsContext', () => ({ useDepartments: () => ({ departments: fixture.departments }) }))
vi.mock('./guidelinesContext', () => ({ useGuidelines: () => ({ currentGuideline: { name: 'GVP', version: '4.0' } }) }))
// The database: each created SOP is read back as a draft by its author, in the department asked for.
const database = vi.hoisted(() => ({ created: [] as { title: string; departmentId: string; description?: string }[] }))
vi.mock('../services/files', () => ({
  fileTypeOf: (name: string) => (name.endsWith('.pdf') ? 'pdf' : 'docx'),
  uploadSopFile: vi.fn(async (_userId: string, file: File) => ({ storagePath: 'visitor/file.pdf', fileName: file.name })),
}))
vi.mock('../services/sops', () => ({
  fetchSops: vi.fn(async () => []),
  createSop: vi.fn(async (input: { title: string; departmentId: string; description?: string }) => {
    database.created.push(input)
    return 'created-' + database.created.length
  }),
  fetchSop: vi.fn(async (id: string) => {
    const input = database.created[Number(id.replace('created-', '')) - 1]
    return input ? sop({ id, ...input, authorId: fixture.userId, status: 'draft' }) : sop({ id, coAuthorIds: fixture.sops.find((item) => item.id === id)?.coAuthorIds ?? [] })
  }),
  uploadSopVersion: vi.fn(async () => '2'),
  deleteSopVersion: vi.fn(async () => {}),
  addCoAuthors: vi.fn(async () => {}),
  removeCoAuthor: vi.fn(async () => {}),
}))

function person(id: string, departmentId: string, permissions: User['permissions']): User {
  return { id, name: id, email: id + '@example.test', initials: 'TT', departmentId, permissions }
}
function sop(overrides: Partial<Sop> = {}): Sop {
  return { id: 'foreign', code: 'SOP-100', title: 'Private SOP', departmentId: 'other', description: 'Private description', authorId: 'writer', coAuthorIds: [], status: 'draft', version: '1', lastUpdated: '2026-10-23', fileName: 'private.pdf', fileType: 'pdf', fileUrl: '/private.pdf', reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [], versions: [{ version: '1', fileName: 'private.pdf', fileType: 'pdf', uploadedById: 'writer', uploadedAt: '2026-10-23T09:00:00Z' }], ...overrides }
}
const grant = (): UserRequest => ({ id: 'access-other', type: 'department-access', departmentId: 'other', requesterId: 'visitor', title: 'Directory access', description: '', status: 'approved', createdAt: '2026-10-23' })
const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' })
const draft = (departmentId = 'home'): NewDraft => ({ title: 'Home procedure', departmentId, description: 'Description retained', file: pdf('procedure.pdf') })
/** Whether an action is refused, whether it throws at once or its promise is rejected. */
const refused = (action: () => unknown) => expect(Promise.resolve().then(action)).rejects.toThrow()
function storeFor(userId: string, sops: Sop[] = []): SopsStore {
  fixture.userId = userId
  fixture.sops.splice(0, fixture.sops.length, ...sops)
  const observe = vi.fn<(store: SopsStore) => void>()
  function Capture() { observe(useSops()); return null }
  renderToStaticMarkup(<SopsProvider><Capture /></SopsProvider>)
  return observe.mock.calls.at(-1)![0]
}
beforeEach(() => {
  fixture.users.splice(0, fixture.users.length, person('visitor', 'home', ['author', 'reviewer', 'approver']), person('writer', 'other', ['author']), person('assigned-reviewer', 'other', ['reviewer']), person('assigned-approver', 'other', ['approver']), person('route-target', 'home', ['reviewer']))
  fixture.departments.splice(0, fixture.departments.length, { id: 'home', name: 'Home', initials: 'HM', description: '' }, { id: 'other', name: 'Other', initials: 'OT', description: '' })
  fixture.sops.splice(0, fixture.sops.length)
  database.created.splice(0)
})

describe('directory access never authorizes authoring', () => {
  it('enforces the required 50-character title limit before uploading or saving a direct draft mutation', async () => {
    const store = storeFor('visitor')
    for (const title of ['', '   ', 'x'.repeat(51)]) {
      await expect(store.addDraft({ ...draft(), title })).rejects.toThrow(/1 to 50/)
      expect(database.created).toEqual([])
    }
    const title = 'x'.repeat(50)
    await expect(store.addDraft({ ...draft(), title })).resolves.toMatchObject({ title, authorId: 'visitor', departmentId: 'home' })
    await expect(store.addDraft({ ...draft(), title: '  Trimmed title  ' })).resolves.toMatchObject({ title: 'Trimmed title' })
  })
  it('preserves home-department authoring, descriptions and permissions', async () => {
    const user = fixture.users[0], before = structuredClone(user)
    expect(getDirectoryDepartments(user, [grant()], fixture.departments).map((department) => department.id)).toEqual(['home', 'other'])
    const store = storeFor('visitor')
    const created = await store.addDraft(draft())
    expect(created).toMatchObject({ departmentId: 'home', authorId: 'visitor', description: 'Description retained', status: 'draft' })
    expect((await store.addDraft(draft())).id).not.toBe(created.id)
    expect(user).toEqual(before)
  })
  it('rejects direct creation in an approved foreign directory', async () => {
    expect(getDirectoryDepartments(fixture.users[0], [grant()], fixture.departments)).toHaveLength(2)
    const store = storeFor('visitor')
    await expect(store.addDraft(draft('other'))).rejects.toThrow(/home department/)
    expect(database.created).toEqual([])
  })
  it.each(['signed-out', 'no-author', 'deleted', 'admin', 'removed-home', 'missing-home'] as const)('refuses new drafts for %s', async (condition) => {
    if (condition === 'no-author') fixture.users[0].permissions = ['reviewer']
    if (condition === 'deleted') fixture.users[0].deletedAt = '2026-10-23'
    if (condition === 'admin') fixture.users[0].permissions.push('admin')
    if (condition === 'removed-home') fixture.departments[0].removedAt = '2026-10-23'
    if (condition === 'missing-home') fixture.departments.splice(0, 1)
    await expect(storeFor(condition === 'signed-out' ? 'unknown' : 'visitor').addDraft(draft())).rejects.toThrow()
    expect(database.created).toEqual([])
  })
  it('cannot edit, delete, manage authors, run checks or change dates without a separate relationship', async () => {
    const foreign = sop(), before = JSON.stringify(foreign), store = storeFor('visitor', [foreign])
    const actions = [
      () => store.uploadVersion(foreign.id, pdf('replacement.pdf')),
      () => store.deleteVersion(foreign.id, '1'), () => store.addCoAuthors(foreign.id, ['route-target']),
      () => store.removeCoAuthor(foreign.id, 'writer'), () => store.runCheck(foreign.id),
      () => store.shiftDueDates(foreign.id, 3),
    ]
    for (const action of actions) await refused(action)
    expect(JSON.stringify(foreign)).toBe(before)
  })
  it('preserves an explicit cross-department coauthor assignment', async () => {
    const store = storeFor('visitor', [sop({ coAuthorIds: ['visitor'] })])
    await expect(store.uploadVersion('foreign', pdf('coauthored.pdf'))).resolves.toBeUndefined()
  })
})

describe('directory access never substitutes for review assignments or acting identity', () => {
  it('rejects unassigned and impersonated review completion, rejection and routing', () => {
    const foreign = sop({ status: 'in-review', reviewers: [{ userId: 'assigned-reviewer', decision: 'pending' }] })
    const before = JSON.stringify(foreign), store = storeFor('visitor', [foreign])
    for (const actorId of ['visitor', 'assigned-reviewer']) {
      expect(() => store.completeReview(foreign.id, actorId)).toThrow()
      expect(() => store.returnAsReviewer(foreign.id, actorId, 'Reason')).toThrow()
      expect(() => store.routeToReviewer(foreign.id, actorId, 'route-target')).toThrow()
    }
    expect(JSON.stringify(foreign)).toBe(before)
  })
  it('rejects unassigned and impersonated approval, return and publication', () => {
    const store = storeFor('visitor', [sop({ status: 'in-approval', approvers: [{ userId: 'assigned-approver', decision: 'pending' }] })])
    for (const actorId of ['visitor', 'assigned-approver']) {
      expect(() => store.approveAs('foreign', actorId)).toThrow()
      expect(() => store.returnAsApprover('foreign', actorId, 'Reason')).toThrow()
    }
    const approved = storeFor('visitor', [sop({ status: 'approved', approvers: [{ userId: 'assigned-approver', decision: 'approved' }] })])
    expect(() => approved.publishAs('foreign', 'visitor')).toThrow()
    expect(() => approved.publishAs('foreign', 'assigned-approver')).toThrow()
  })
  it('requires actual Reviewer and Approver permission even when assigned', () => {
    fixture.users[0].permissions = ['author']
    const reviewing = storeFor('visitor', [sop({ status: 'in-review', reviewers: [{ userId: 'visitor', decision: 'pending' }] })])
    expect(() => reviewing.completeReview('foreign', 'visitor')).toThrow()
    const approving = storeFor('visitor', [sop({ status: 'in-approval', approvers: [{ userId: 'visitor', decision: 'pending' }] })])
    expect(() => approving.approveAs('foreign', 'visitor')).toThrow()
  })
  it('preserves a separately assigned cross-department legacy review', () => {
    const before = structuredClone(fixture.users[0])
    const store = storeFor('visitor', [sop({ status: 'in-review', reviewers: [{ userId: 'visitor', decision: 'pending' }] })])
    expect(() => store.completeReview('foreign', 'visitor', 'Checked')).not.toThrow()
    expect(() => store.completeReview('foreign', 'visitor')).toThrow()
    expect(fixture.users[0]).toEqual(before)
  })
  it('preserves separately assigned approval and publication', () => {
    const before = structuredClone(fixture.users[0])
    const store = storeFor('visitor', [sop({ status: 'in-approval', approvers: [{ userId: 'visitor', decision: 'pending' }] })])
    expect(() => store.approveAs('foreign', 'visitor')).not.toThrow()
    expect(() => store.publishAs('foreign', 'visitor')).not.toThrow()
    expect(() => store.publishAs('foreign', 'visitor')).toThrow()
    expect(fixture.users[0]).toEqual(before)
  })
})
