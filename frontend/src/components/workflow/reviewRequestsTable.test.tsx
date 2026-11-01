import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Department, Sop, User } from '../../data/mock/types'
import { acceptInternalReview, addInternalReviewers, currentInternalRound, decideInternalReview, declineInternalReview, removeInternalReviewer, startInternalReview, expireUnanswered, resendInternalReview } from '../../lib/internalReview'
import { latestAssignmentOf } from '../../lib/internalReviewStatus'
import { endOfRiyadhDay } from '../../lib/riyadhWorkingDays'
import { FormDialog } from '../ui/FormDialog'
import { InternalReviewPanel } from './InternalReviewPanel'
import { ReviewNotesDialog } from './ReviewNotesDialog'

const fixture = vi.hoisted(() => ({
  users: [
    { id: 'author', name: 'Main Author', permissions: ['author'], departmentId: 'home' },
    { id: 'alpha', name: 'Reviewer Alpha', permissions: ['reviewer'], departmentId: 'home' },
    { id: 'beta', name: 'Reviewer Beta', permissions: ['reviewer'], departmentId: 'home' },
    { id: 'gamma', name: 'Reviewer Gamma', permissions: ['reviewer'], departmentId: 'home' },
  ] as User[],
  departments: [{ id: 'home', name: 'Home Department', initials: 'HM', description: '' }] as Department[],
}))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: fixture.users, activeUsers: fixture.users, nameOf: (id: string) => fixture.users.find((user) => user.id === id)?.name ?? id, getUser: (id: string) => fixture.users.find((user) => user.id === id) }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ departments: fixture.departments }) }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ removeInternalReviewer: vi.fn() }) }))

const env = () => ({ users: fixture.users, departments: fixture.departments })
function draft(): Sop {
  return { id: 'test', code: 'TEST', title: 'Table fixture', version: '1', departmentId: 'home', authorId: 'author', coAuthorIds: [], status: 'draft', lastUpdated: '2026-10-23', fileName: 'test.pdf', fileType: 'pdf', versions: [{ version: '1', fileName: 'test.pdf', fileType: 'pdf', uploadedAt: new Date().toISOString() }], reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [{ id: 'check', sopId: 'test', version: '1', status: 'completed', startedAt: new Date().toISOString(), guideline: { name: 'GVP', version: '4.0' }, findings: [] }] }
}
const request = (sop: Sop, userId: string) => latestAssignmentOf(currentInternalRound(sop), userId)!
function started(reviewDurationDays?: number) {
  return startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha', 'beta', 'gamma'], reviewDurationDays }, env())
}
const render = (sop: Sop, canRemove = true) => renderToStaticMarkup(<InternalReviewPanel sop={sop} canRemove={canRemove} table showEmpty />)
const table = (html: string) => html.slice(html.indexOf('<table'), html.indexOf('</table>'))
const row = (html: string, name: string) => table(html).match(new RegExp(`<tr[^>]*><th scope="row"[^>]*>${name}.*?</tr>`))![0]

beforeEach(() => { vi.useFakeTimers({ now: new Date('2026-10-23T12:00:00+03:00') }) })
afterEach(() => vi.useRealTimers())

describe('Reviewers table on the author SOP page', () => {
  it('has the agreed columns, row headers and a stacked card for each request', () => {
    const html = render(started())
    expect([...table(html).matchAll(/<th scope="col"[^>]*>([^<]+)</g)].map((match) => match[1])).toEqual(['Reviewer', 'Department', 'Division', 'Request Sent', 'Status', 'Decision Date', 'Review Deadline', 'Actions'])
    expect(table(html).match(/<th scope="row"/g)).toHaveLength(3)
    expect(row(html, 'Reviewer Alpha')).toContain('Home Department')
    expect(row(html, 'Reviewer Alpha')).toContain('<td class="py-3 pr-4">—</td>')
    expect(row(html, 'Reviewer Alpha')).toContain('Oct 23, 2026')
    expect(html.match(/<li class="rounded-lg border border-beige p-4">/g)).toHaveLength(3)
    expect(html).toContain('xl:hidden')
  })

  it('shows every request, with lighter text only where the reviewer is no longer taking part', () => {
    let sop = started()
    const round = currentInternalRound(sop)!
    sop = acceptInternalReview(sop, 'alpha', round.id, request(sop, 'alpha').id, env())
    sop = declineInternalReview(sop, 'beta', round.id, request(sop, 'beta').id, 'On leave', env())
    sop = removeInternalReviewer(sop, 'author', round.id, request(sop, 'gamma').id, 'Not needed', env())
    const html = render(sop)
    for (const label of ['Accepted', 'Declined', 'Removed']) expect(table(html)).toContain(`</span>${label}</span>`)
    expect(row(html, 'Reviewer Alpha')).toContain('text-maroon')
    expect(table(html)).toMatch(/<tr class="text-text-gray"><th scope="row"[^>]*>Reviewer Beta/)
    expect(table(html)).toMatch(/<tr class="text-text-gray"><th scope="row"[^>]*>Reviewer Gamma/)
  })

  it('keeps every row of a declined reviewer asked again, with the decline reason', () => {
    let sop = started()
    sop = declineInternalReview(sop, 'alpha', currentInternalRound(sop)!.id, request(sop, 'alpha').id, 'On leave', env())
    sop = addInternalReviewers(sop, 'author', { reviewerIds: ['alpha'] }, env())
    const html = render(sop)
    expect(table(html).match(/<th scope="row"[^>]*>Reviewer Alpha/g)).toHaveLength(2)
    expect(table(html)).toContain('</span>Declined</span>')
    expect(table(html)).toContain('</span>Pending</span>')
    expect(html.match(/aria-label="View Comments from Reviewer Alpha"/g)!.length).toBeGreaterThan(0)
    expect(html.match(/<li class="rounded-lg border border-beige p-4">/g)).toHaveLength(4)
  })
  it('keeps every row of a removed reviewer asked again', () => {
    let sop = started()
    sop = removeInternalReviewer(sop, 'author', currentInternalRound(sop)!.id, request(sop, 'alpha').id, 'Not needed', env())
    sop = addInternalReviewers(sop, 'author', { reviewerIds: ['alpha'] }, env())
    expect(table(render(sop)).match(/<th scope="row"[^>]*>Reviewer Alpha/g)).toHaveLength(2)
    expect(table(render(sop))).toContain('</span>Removed</span>')
  })

  it('keeps — before acceptance, then shows the due date and the decision date', () => {
    let sop = started(5)
    expect(row(render(sop), 'Reviewer Alpha').match(/—<\/td>/g)!.length).toBeGreaterThanOrEqual(3)
    sop = acceptInternalReview(sop, 'alpha', currentInternalRound(sop)!.id, request(sop, 'alpha').id, env())
    const accepted = row(render(sop), 'Reviewer Alpha')
    expect(accepted).toContain(`dateTime="${request(sop, 'alpha').reviewDueDate}"`)
    expect(accepted).toContain(`dateTime="${request(sop, 'alpha').acceptedAt}"`)
  })

  it('offers the notes only when there is something to show', () => {
    let sop = started()
    const round = currentInternalRound(sop)!
    sop = acceptInternalReview(sop, 'alpha', round.id, request(sop, 'alpha').id, env())
    sop = decideInternalReview(sop, 'alpha', round.id, request(sop, 'alpha').id, 'returned', 'Revise section 2', env())
    sop = declineInternalReview(sop, 'beta', round.id, request(sop, 'beta').id, 'On leave', env())
    const html = render(sop)
    expect(row(html, 'Reviewer Alpha')).toContain('aria-label="View Comments from Reviewer Alpha"')
    expect(row(html, 'Reviewer Beta')).toContain('aria-label="View Comments from Reviewer Beta"')
    expect(row(html, 'Reviewer Gamma')).not.toContain('View Comments')
    expect(row(html, 'Reviewer Gamma')).toContain('No Comments')
  })

  it('offers Remove on pending, accepted, completed and returned requests only, to the main author', () => {
    let sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha', 'beta'] }, env())
    const round = currentInternalRound(sop)!
    sop = acceptInternalReview(sop, 'alpha', round.id, request(sop, 'alpha').id, env())
    sop = declineInternalReview(sop, 'beta', round.id, request(sop, 'beta').id, 'On leave', env())
    const html = render(sop)
    expect(row(html, 'Reviewer Alpha')).toContain('aria-label="Remove Reviewer Alpha from this review"')
    expect(row(html, 'Reviewer Beta')).not.toContain('from this review')
    expect(render(sop, false)).not.toContain('from this review')
  })

  it('shows the pencil to the main author on requests being reviewed in the current version only', () => {
    let sop = started()
    sop = acceptInternalReview(sop, 'alpha', currentInternalRound(sop)!.id, request(sop, 'alpha').id, env())
    const pencil = row(render(sop), 'Reviewer Alpha').match(/<button[^>]*aria-label="Edit Review Deadline for Reviewer Alpha"[^>]*>/)![0]
    expect(pencil).not.toContain('aria-disabled="true"')
    expect(row(render(sop), 'Reviewer Beta')).not.toContain('Edit Review Deadline')
    expect(render(sop, false)).not.toContain('Edit Review Deadline')
    const finished = decideInternalReview(sop, 'alpha', currentInternalRound(sop)!.id, request(sop, 'alpha').id, 'completed', undefined, env())
    expect(row(render(finished), 'Reviewer Alpha')).not.toContain('Edit Review Deadline')
  })

  it('shows one disclosure per version, newest first, with only the newest expanded', () => {
    const sop = started()
    const round = currentInternalRound(sop)!
    const twoVersions: Sop = { ...sop, version: '2', internalReviewRounds: [round, { ...round, id: 'second', version: '2' }] }
    const buttons = [...render(twoVersions).matchAll(/<h3><button[^>]*aria-expanded="(true|false)"[^>]*>.*?<\/svg>([^<]+)<\/button><\/h3>/g)].map((match) => [match[2], match[1]])
    expect(buttons).toEqual([['Version 2 (Current)', 'true'], ['Version 1', 'false']])
    expect(render(twoVersions)).toContain(`id="review-requests-${round.id}" hidden=""`)
  })

  it('keeps the empty state when there are no requests', () => {
    expect(render(draft())).toContain('No active reviewers.')
    expect(render(draft())).not.toContain('<table')
  })
})

describe('ReviewNotesDialog', () => {
  it('names the dialog and shows each note with its label and date, and a Close button', () => {
    const html = renderToStaticMarkup(<ReviewNotesDialog title="Comments from Reviewer Alpha" closeLabel="Close" onClose={() => {}}
      labels={{ comment: 'Comments', decline: 'Reason for Declining', removal: 'Reason for Removing' }}
      notes={[{ kind: 'comment', text: 'Revise section 2', date: '2026-10-04T08:00:00Z' }, { kind: 'removal', text: 'Not needed', date: '2026-10-05T08:00:00Z' }]} />)
    const heading = html.match(/<h2 id="([^"]+)"[^>]*>Comments from Reviewer Alpha<\/h2>/)!
    expect(html.match(/<dialog[^>]*>/)![0]).toContain(`aria-labelledby="${heading[1]}"`)
    for (const text of ['>Comments<', 'Revise section 2', 'Oct 4, 2026', '>Reason for Removing<', 'Not needed', 'Oct 5, 2026', '>Close<']) expect(html).toContain(text)
  })
})

describe('an expired request in the table', () => {
  function expired() {
    const sop = started(5)
    return expireUnanswered(sop, Date.parse(endOfRiyadhDay(sop.internalReviewRounds![0].assignments[0].responseDueDate!)))
  }
  it('shows the Expired label in lighter text, and the main author can remove the reviewer', () => {
    const html = render(expired())
    expect(table(html)).toContain('</span>Expired</span>')
    expect(table(html)).toMatch(/<tr class="text-text-gray"><th scope="row"[^>]*>Reviewer Alpha/)
    expect(row(html, 'Reviewer Alpha')).toContain('aria-label="Remove Reviewer Alpha from this review"')
    expect(render(expired(), false)).not.toContain('from this review')
  })
  it('offers Send Again to the main author only, and not once it was sent', () => {
    const html = render(expired())
    expect(row(html, 'Reviewer Alpha')).toContain('aria-label="Send Again to Reviewer Alpha"')
    expect(render(expired(), false)).not.toContain('Send Again')
    const sop = expired()
    const sent = resendInternalReview(sop, 'author', request(sop, 'alpha').id, env())
    const rows = table(render(sent)).match(/<tr[^>]*><th scope="row"[^>]*>Reviewer Alpha.*?<\/tr>/g)!
    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toContain('Send Again')
    expect(rows[0]).toContain('</span>Pending</span>')
    expect(rows[0]).not.toContain('</span>Expired</span>')
    // In the cards too, and the expired request stays in the data.
    expect(render(sent).match(/<li class="rounded-lg border border-beige p-4">/g)).toHaveLength(3)
    expect(currentInternalRound(sent)!.assignments.filter((item) => item.userId === 'alpha').map((item) => item.decision)).toEqual(['expired', 'pending'])
  })
  it('hides an expired row sent again but keeps a later decline', () => {
    const sop = expired()
    const sent = resendInternalReview(sop, 'author', request(sop, 'alpha').id, env())
    const declined = declineInternalReview(sent, 'alpha', currentInternalRound(sent)!.id, request(sent, 'alpha').id, 'On leave', env())
    const html = render(declined)
    expect(table(html).match(/<th scope="row"[^>]*>Reviewer Alpha/g)).toHaveLength(1)
    expect(row(html, 'Reviewer Alpha')).toContain('</span>Declined</span>')
  })
  it('keeps the latest row of a reviewer who was not asked again', () => {
    let sop = started()
    const round = currentInternalRound(sop)!
    sop = declineInternalReview(sop, 'alpha', round.id, request(sop, 'alpha').id, 'On leave', env())
    sop = removeInternalReviewer(sop, 'author', round.id, request(sop, 'beta').id, 'Not needed', env())
    const html = render(sop)
    expect(row(html, 'Reviewer Alpha')).toContain('</span>Declined</span>')
    expect(row(html, 'Reviewer Beta')).toContain('</span>Removed</span>')
    expect(row(html, 'Reviewer Gamma')).toContain('</span>Pending</span>')
  })
  it('shows a reviewer once per version, so another version keeps its own row', () => {
    const sop = started()
    const first = currentInternalRound(sop)!
    const two: Sop = { ...sop, version: '2', internalReviewRounds: [first, { ...first, id: 'second', version: '2' }] }
    expect(render(two).match(/<th scope="row"[^>]*>Reviewer Alpha/g)).toHaveLength(2)
  })
  it('keeps the trash icon off declined rows', () => {
    const sop = started(5)
    const declined = declineInternalReview(sop, 'alpha', currentInternalRound(sop)!.id, request(sop, 'alpha').id, 'On leave', env())
    expect(row(render(declined), 'Reviewer Alpha')).not.toContain('from this review')
  })
})

describe('Response in the comments dialog', () => {
  const dialog = (response?: { recipients: string; onSend: (text: string) => Promise<void> }) => renderToStaticMarkup(<ReviewNotesDialog title="Comments from Reviewer Alpha" closeLabel="Close" onClose={() => {}}
    labels={{ comment: 'Comments', decline: 'Reason for Declining', removal: 'Reason for Removing' }} response={response}
    notes={[{ kind: 'comment', text: 'Revise section 2', date: '2026-10-04T08:00:00Z' }]} />)

  it('shows Response beside Close, both filled, only when the reviewer can be responded to', () => {
    const html = dialog({ recipients: 'Reviewer Alpha (Reviewer)', onSend: async () => {} })
    const buttons = html.match(/<button[^>]*>[^<]*<\/button>/g)!
    expect(buttons.map((button) => button.replace(/<[^>]+>/g, ''))).toEqual(['Close', 'Response'])
    for (const button of buttons) expect(button).toContain('bg-maroon')
    expect(html).not.toContain('<textarea')
    expect(dialog()).not.toContain('>Response<')
  })
})

describe('Remove Reviewer dialog', () => {
  it('offers the reason and a × close button, without the description or Keep Reviewer', () => {
    const html = renderToStaticMarkup(<FormDialog open title="Remove Reviewer Alpha from This Review?" confirmLabel="Remove Reviewer" closeLabel="Close" onConfirm={() => {}} onClose={() => {}}><textarea name="removalReason" /></FormDialog>)
    expect(html).toContain('aria-label="Close"')
    expect(html.indexOf('removalReason')).toBeLessThan(html.indexOf('aria-label="Close"'))
    expect(html.match(/<button/g)).toHaveLength(2)
    expect(html).not.toContain('Keep Reviewer')
    expect(html).not.toContain('aria-describedby')
  })
})
