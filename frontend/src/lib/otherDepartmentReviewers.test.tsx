import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { InternalReviewPanel } from '../components/workflow/InternalReviewPanel'
import { SubmitDialog } from '../components/workflow/SubmitDialog'
import { sopWorkflowEn } from '../content/workflow.en'
import type { Department, Sop, User } from '../data/mock/types'
import { acceptInternalReview, addableReviewers, addInternalReviewers, currentInternalRound, decideInternalReview, declineInternalReview, expireUnanswered, hasHomeFinished, homeReviewers, removeInternalReviewer, resendInternalReview, resendIsTooEarly, startInternalReview } from './internalReview'
import { latestAssignmentOf } from './internalReviewStatus'
import { deriveNotifications, isRead } from './notifications'
import { reviewerLostAccess } from './reviewAccess'
import { assignableReviewers } from './reviewFlow'
import { visibleSops } from '../state/visibleSops'
import { endOfRiyadhDay } from './riyadhWorkingDays'

const fixture = vi.hoisted(() => ({
  departments: [
    { id: 'home', name: 'Home Department', initials: 'HD', description: '', qualityControllerId: 'controller' },
    { id: 'other', name: 'Other Department', initials: 'OD', description: '' },
    { id: 'gone', name: 'Gone Department', initials: 'GD', description: '', removedAt: '2026-10-01' },
  ] as Department[],
  users: [] as User[],
}))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ activeUsers: fixture.users, users: fixture.users, nameOf: (id: string) => fixture.users.find((user) => user.id === id)?.name ?? id, getUser: (id: string) => fixture.users.find((user) => user.id === id) }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: fixture.departments, nameOf: (id: string) => fixture.departments.find((item) => item.id === id)?.name ?? id }) }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({}) }))

function person(id: string, permissions: User['permissions'], departmentId: string): User {
  return { id, name: `Name ${id}`, email: `${id}@example.test`, initials: 'NN', permissions, departmentId }
}
fixture.users = [
  person('author', ['author'], 'home'), person('coauthor', ['author', 'reviewer'], 'home'),
  person('h1', ['reviewer'], 'home'), person('h2', ['reviewer'], 'home'), person('controller', ['reviewer', 'approver'], 'home'),
  person('o1', ['reviewer'], 'other'), person('o2', ['reviewer'], 'other'), person('o-author', ['author'], 'other'), person('g1', ['reviewer'], 'gone'),
]
const env = () => ({ users: fixture.users, departments: fixture.departments })
const ids = (users: User[]) => users.map((user) => user.id)
function draft(): Sop {
  return { id: 'sop', code: 'SOP-1', title: 'Cross', departmentId: 'home', authorId: 'author', coAuthorIds: ['coauthor'], version: '1', status: 'draft', lastUpdated: '2026-10-29', fileName: 'a.pdf', fileType: 'pdf',
    versions: [{ version: '1', fileName: 'a.pdf', fileType: 'pdf', uploadedAt: '2026-10-29T05:00:00Z' }], comments: [], timeline: [], reviewers: [], approvers: [], complianceChecks: [] }
}
const start = (reviewerIds = ['h1']) => startInternalReview(draft(), 'author', '4.0', { reviewerIds, reviewDurationDays: 3 }, env())
const request = (sop: Sop, userId: string) => latestAssignmentOf(currentInternalRound(sop), userId)!
const accept = (sop: Sop, userId: string) => acceptInternalReview(sop, userId, currentInternalRound(sop)!.id, request(sop, userId).id, env())
const decide = (sop: Sop, userId: string, decision: 'completed' | 'returned' = 'completed') => decideInternalReview(sop, userId, currentInternalRound(sop)!.id, request(sop, userId).id, decision, 'Comment', env())
const finished = () => decide(accept(start(), 'h1'), 'h1')
const render = (sop: Sop, mode?: 'add' | 'version') => renderToStaticMarkup(<SubmitDialog sop={sop} content={sopWorkflowEn.dialogs} mode={mode} onClose={() => {}} onSubmit={() => {}} />)

beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-26T10:00:00+03:00') }))
afterEach(() => vi.useRealTimers())

describe('who can be picked', () => {
  it('offers any existing department, without authors, co-authors, non-reviewers or the Quality Document Controller', () => {
    expect(ids(assignableReviewers(draft(), env()))).toEqual(['h1', 'h2', 'o1', 'o2'])
    expect(ids(homeReviewers(draft(), env()))).toEqual(['h1', 'h2'])
  })

  it('keeps the first send of a version to the SOP\'s department, even in a mixed batch', () => {
    expect(() => start(['o1'])).toThrow(/home department/)
    expect(() => start(['h1', 'o1'])).toThrow(/home department/)
    expect(currentInternalRound(start(['h1', 'h2']))!.assignments).toHaveLength(2)
  })

  it('needs a same-department reviewer who has finished: pending and accepted are not enough', () => {
    const pending = start()
    expect(hasHomeFinished(pending, env().users)).toBe(false)
    expect(ids(addableReviewers(pending, env()))).toEqual(['h2'])
    expect(() => addInternalReviewers(pending, 'author', { reviewerIds: ['o1'] }, env())).toThrow(/must finish/)
    const accepted = accept(pending, 'h1')
    expect(hasHomeFinished(accepted, env().users)).toBe(false)
    expect(() => addInternalReviewers(accepted, 'author', { reviewerIds: ['o1'] }, env())).toThrow(/must finish/)
    expect(() => addInternalReviewers(accepted, 'author', { reviewerIds: ['h2', 'o1'] }, env())).toThrow(/must finish/)
    expect(request(addInternalReviewers(accepted, 'author', { reviewerIds: ['h2'] }, env()), 'h2').decision).toBe('pending')
  })

  it.each(['completed', 'returned'] as const)('counts a same-department reviewer who %s it', (decision) => {
    const sop = accept(start(['h1', 'h2']), 'h1')
    expect(hasHomeFinished(decide(sop, 'h1', decision), env().users)).toBe(true)
  })

  it('opens every department once one has finished, and a batch can then mix them', () => {
    const sop = finished()
    expect(ids(addableReviewers(sop, env()))).toEqual(['h2', 'o1', 'o2'])
    const added = addInternalReviewers(sop, 'author', { reviewerIds: ['h2', 'o1'] }, env())
    expect(request(added, 'o1').decision).toBe('pending')
    expect(currentInternalRound(added)!.status).toBe('open')
  })

  it('does not count someone who declined, was removed or has expired, or another department', () => {
    const started = start(['h1', 'h2'])
    const round = currentInternalRound(started)!
    const declined = declineInternalReview(started, 'h1', round.id, request(started, 'h1').id, 'On leave', env())
    const removed = removeInternalReviewer(declined, 'author', round.id, request(declined, 'h2').id, 'Not needed', env())
    expect(hasHomeFinished(removed, env().users)).toBe(false)
    const other = addInternalReviewers(finished(), 'author', { reviewerIds: ['o1'] }, env())
    const gone = removeInternalReviewer(accept(other, 'o1'), 'author', currentInternalRound(other)!.id, request(other, 'h1').id, 'Not needed', env())
    expect(hasHomeFinished(decide(gone, 'o1'), env().users)).toBe(false)
  })

  it.each(['pending', 'accepted', 'declined', 'withdrawn', 'expired', 'removed'] as const)('does not count a same-department request that is %s', (decision) => {
    const sop = start(['h1', 'h2'])
    const round = currentInternalRound(sop)!
    const changed = { ...sop, internalReviewRounds: [{ ...round, assignments: round.assignments.map((item) => item.userId === 'h1' ? { ...item, decision } : item) }] }
    expect(hasHomeFinished(changed, env().users)).toBe(false)
  })

  it('stops counting a same-department reviewer who finished and was then removed', () => {
    const sop = addInternalReviewers(finished(), 'author', { reviewerIds: ['h2'] }, env())
    const removed = removeInternalReviewer(sop, 'author', currentInternalRound(sop)!.id, request(sop, 'h1').id, 'Not needed', env())
    expect(hasHomeFinished(removed, env().users)).toBe(false)
  })

  it('lets an other-department reviewer accept and finish', () => {
    const added = addInternalReviewers(finished(), 'author', { reviewerIds: ['o1'] }, env())
    expect(request(decide(accept(added, 'o1'), 'o1'), 'o1').decision).toBe('completed')
  })

  it('counts by the reviewer\'s current department', () => {
    const sop = finished()
    const moved = env().users.map((user) => user.id === 'h1' ? { ...user, departmentId: 'other' } : user)
    expect(hasHomeFinished(sop, moved)).toBe(false)
  })
})

describe('Send Again by department', () => {
  const end = Date.parse(endOfRiyadhDay('2026-10-30'))
  function expiredOther() {
    const added = addInternalReviewers(finished(), 'author', { reviewerIds: ['o1'] }, env())
    return expireUnanswered(added, end)
  }

  it('sends an expired other-department request again once a same-department reviewer has finished', () => {
    const sop = expiredOther()
    expect(resendIsTooEarly(sop, request(sop, 'o1'), env().users)).toBe(false)
    expect(request(resendInternalReview(sop, 'author', request(sop, 'o1').id, env()), 'o1').decision).toBe('pending')
  })

  it('disables the icon with a tooltip while no same-department reviewer has finished', () => {
    const sop = expiredOther()
    const round = currentInternalRound(sop)!
    const icon = (item: Sop) => renderToStaticMarkup(<InternalReviewPanel sop={item} canRemove table />).match(/<button[^>]*aria-label="Send Again to Name o1"[^>]*>/)![0]
    expect(icon(sop)).not.toContain('aria-disabled="true"')
    const withoutHome = removeInternalReviewer(sop, 'author', round.id, request(sop, 'h1').id, 'Not needed', env())
    expect(icon(withoutHome)).toContain('aria-disabled="true"')
    expect(renderToStaticMarkup(<InternalReviewPanel sop={withoutHome} canRemove table />)).toContain('A reviewer from Home Department must finish this version first.')
  })

  it('refuses it while none has, and always allows a same-department reviewer', () => {
    const sop = expiredOther()
    const round = currentInternalRound(sop)!
    const withoutHome = removeInternalReviewer(sop, 'author', round.id, request(sop, 'h1').id, 'Not needed', env())
    expect(resendIsTooEarly(withoutHome, request(withoutHome, 'o1'), env().users)).toBe(true)
    expect(() => resendInternalReview(withoutHome, 'author', request(withoutHome, 'o1').id, env())).toThrow(/must finish/)
    const home = expireUnanswered(start(), end)
    expect(resendIsTooEarly(home, request(home, 'h1'), env().users)).toBe(false)
  })
})

describe('losing access', () => {
  const user = (id: string) => fixture.users.find((item) => item.id === id)!
  const withOther = () => addInternalReviewers(finished(), 'author', { reviewerIds: ['o1'] }, env())
  const round = (sop: Sop) => currentInternalRound(sop)!
  const declined = () => { const sop = withOther(); return declineInternalReview(sop, 'o1', round(sop).id, request(sop, 'o1').id, 'Busy', env()) }

  it('keeps access while taking part or finished', () => {
    const sop = accept(withOther(), 'o1')
    expect(reviewerLostAccess(sop, user('o1'))).toBe(false)
    expect(visibleSops([sop], user('o1'), [])).toHaveLength(1)
    expect(reviewerLostAccess(decide(sop, 'o1'), user('o1'))).toBe(false)
  })

  it('loses the SOP when the latest request is declined, removed or expired', () => {
    expect(reviewerLostAccess(declined(), user('o1'))).toBe(true)
    expect(visibleSops([declined()], user('o1'), [])).toEqual([])
    const sop = withOther()
    expect(reviewerLostAccess(removeInternalReviewer(sop, 'author', round(sop).id, request(sop, 'o1').id, 'Not needed', env()), user('o1'))).toBe(true)
    expect(reviewerLostAccess(expireUnanswered(sop, Date.parse(endOfRiyadhDay('2026-10-30'))), user('o1'))).toBe(true)
  })

  it('goes by the latest request: asked again gives access back', () => {
    const again = addInternalReviewers(declined(), 'author', { reviewerIds: ['o1'] }, env())
    expect(reviewerLostAccess(again, user('o1'))).toBe(false)
    expect(visibleSops([again], user('o1'), [])).toHaveLength(1)
  })

  it('keeps a same-department reviewer\'s access as it was', () => {
    const sop = start(['h1', 'h2'])
    expect(reviewerLostAccess(declineInternalReview(sop, 'h1', round(sop).id, request(sop, 'h1').id, 'Busy', env()), user('h1'))).toBe(false)
  })

  it('still tells them through their closed requests, with no SOP link', () => {
    const closedRequests = [
      { id: 'one', sopTitle: 'Cross', version: '1', status: 'expired' as const, closedAt: '2026-10-20T00:00:00Z' },
      { id: 'two', sopTitle: 'Other', version: '2', status: 'removed' as const, reason: 'Not needed', closedAt: '2026-10-21T00:00:00Z' },
      { id: 'three', sopTitle: 'Third', version: '1', status: 'declined' as const, reason: 'Busy', closedAt: '2026-10-22T00:00:00Z' },
    ]
    const notifications = deriveNotifications('o1', { sops: [], requests: [], now: Date.now(), closedRequests })
    expect(notifications).toEqual([
      expect.objectContaining({ type: 'reviewer-removed', sopTitle: 'Other', reason: 'Not needed', forReviewer: true, link: '/reviews' }),
      expect.objectContaining({ type: 'review-expired', sopTitle: 'Cross', version: '1', forReviewer: true, unresolved: true, link: '/reviews' }),
    ])
    for (const item of notifications) expect(item.sopId).toBeUndefined()
    expect(isRead(notifications[1], new Set(), Date.now())).toBe(false)
  })
})

describe('the Submit for Review dialog', () => {
  const departmentOptions = (html: string) => html.match(/<ul[^>]*aria-label="Department"[^>]*>.*?<\/ul>/)![0]
    .match(/role="option"[^>]*>([^<]+)/g)!.map((option) => option.replace(/.*>/, ''))

  it('starts on the SOP\'s department, listing every existing one, and shows its reviewers on the first send', () => {
    const html = render(draft())
    expect(html.match(/<input[^>]*name="reviewDepartment"[^>]*>/)![0]).toContain('value="Home Department"')
    expect(departmentOptions(html)).toEqual(['Home Department', 'Other Department'])
    for (const name of ['Name h1', 'Name h2']) expect(html).toContain(name)
    for (const name of ['Name o1', 'Name controller', 'Name g1']) expect(html).not.toContain(name)
    expect(html).not.toContain('name="reviewerDepartment"')
  })

  it('explains why other departments\' reviewers are not offered yet in Add Reviewers', () => {
    const html = render(start(), 'add')
    expect(html).toContain('Reviewers from other departments can be added once a reviewer from Home Department has finished this version.')
    expect(html).not.toContain('Name o1')
  })

  it('lists the chosen department\'s reviewers, with their department, once one has finished', () => {
    const html = render(finished(), 'add')
    expect(departmentOptions(html)).toEqual(['Home Department', 'Other Department'])
    // Home Department is chosen: its reviewers only (h1 has finished, so h2 is the one left to add).
    expect(html).toContain('Name h2')
    expect(html).toContain('>Home Department</span>')
    expect(html).not.toContain('Name o1')
    expect(html).not.toContain('has finished this version')
  })

  const lockedFields = (html: string) => (html.match(/\[&amp;_input\]:bg-beige\/50/g) ?? []).length

  it('makes Division and Department look read-only on a first review, while both lists still open', () => {
    const html = render(draft())
    expect(lockedFields(html)).toBe(2)
    for (const name of ['reviewDivision', 'reviewDepartment']) {
      const input = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))![0]
      expect(input).toContain('role="combobox"')
      expect(input).not.toContain(' disabled=""')
      expect(input).not.toContain('readOnly')
    }
    expect(departmentOptions(html)).toEqual(['Home Department', 'Other Department'])
  })

  it('locks Add Reviewers while no same-department reviewer has finished, even after one was removed', () => {
    expect(lockedFields(render(start(), 'add'))).toBe(2)
    const sop = start(['h1', 'h2'])
    const removed = removeInternalReviewer(sop, 'author', currentInternalRound(sop)!.id, request(sop, 'h1').id, 'Not needed', env())
    expect(lockedFields(render(removed, 'add'))).toBe(2)
    expect(lockedFields(render(accept(removed, 'h2'), 'add'))).toBe(2)
  })

  it.each(['completed', 'returned'] as const)('unlocks Add Reviewers once a same-department reviewer %s it', (decision) => {
    const html = render(decide(accept(start(['h1', 'h2']), 'h1'), 'h1', decision), 'add')
    expect(lockedFields(html)).toBe(0)
    expect(html).not.toContain('[&amp;_input]:border-beige')
  })

  it('locks Add Reviewers again when the only same-department reviewer who finished is removed', () => {
    const sop = addInternalReviewers(finished(), 'author', { reviewerIds: ['h2'] }, env())
    const removed = removeInternalReviewer(sop, 'author', currentInternalRound(sop)!.id, request(sop, 'h1').id, 'Not needed', env())
    expect(lockedFields(render(removed, 'add'))).toBe(2)
  })
})
