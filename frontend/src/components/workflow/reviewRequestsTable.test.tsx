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
/** A row's button by its accessible name. */
const button = (html: string, name: string, label: string) => row(html, name).match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? ''
const row = (html: string, name: string) => table(html).match(new RegExp(`<tr[^>]*><th scope="row"[^>]*>${name}.*?</tr>`))![0]

beforeEach(() => { vi.useFakeTimers({ now: new Date('2026-10-23T12:00:00+03:00') }) })
afterEach(() => vi.useRealTimers())

describe('Reviewers table on the author SOP page', () => {
  it('has the agreed columns, row headers and a stacked card for each request', () => {
    const html = render(started())
    expect([...table(html).matchAll(/<th scope="col"[^>]*>([^<]+)</g)].map((match) => match[1])).toEqual(['Reviewer', 'Division', 'Department', 'Request Sent', 'Status', 'Response Date', 'Review Deadline', 'Send Again', 'Edit', 'Delete'])
    expect(table(html).match(/<th scope="row"/g)).toHaveLength(3)
    // The cards use the same label; the old one is gone.
    expect(html.slice(html.indexOf('</table>')).match(/>Response Date</g)).toHaveLength(3)
    expect(html).not.toContain('Decision Date')
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

  it('keeps every row of a declined reviewer asked again; the decline reason is in the Review Timeline', () => {
    let sop = started()
    sop = declineInternalReview(sop, 'alpha', currentInternalRound(sop)!.id, request(sop, 'alpha').id, 'On leave', env())
    sop = addInternalReviewers(sop, 'author', { reviewerIds: ['alpha'] }, env())
    const html = render(sop)
    expect(table(html).match(/<th scope="row"[^>]*>Reviewer Alpha/g)).toHaveLength(2)
    expect(table(html)).toContain('</span>Declined</span>')
    expect(table(html)).toContain('</span>Pending</span>')
    expect(html).not.toContain('aria-label="View Comments from Reviewer Alpha"')
    expect(html).not.toContain('On leave')
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

  it('has no eye: comments and reasons open from the Review Timeline', () => {
    let sop = started()
    const round = currentInternalRound(sop)!
    sop = acceptInternalReview(sop, 'alpha', round.id, request(sop, 'alpha').id, env())
    sop = decideInternalReview(sop, 'alpha', round.id, request(sop, 'alpha').id, 'returned', 'Revise section 2', env())
    sop = declineInternalReview(sop, 'beta', round.id, request(sop, 'beta').id, 'On leave', env())
    const html = render(removeInternalReviewer(sop, 'author', round.id, request(sop, 'gamma').id, 'Not needed', env()))
    for (const text of ['View Comments', 'lucide-eye', 'Revise section 2', 'On leave', 'Not needed', '>Preview<']) expect(html).not.toContain(text)
  })

  it('enables Delete on pending, accepted, completed and returned requests, and disables it with the reason otherwise', () => {
    let sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha', 'beta', 'gamma'] }, env())
    const round = currentInternalRound(sop)!
    sop = acceptInternalReview(sop, 'alpha', round.id, request(sop, 'alpha').id, env())
    sop = declineInternalReview(sop, 'beta', round.id, request(sop, 'beta').id, 'On leave', env())
    sop = removeInternalReviewer(sop, 'author', round.id, request(sop, 'gamma').id, 'Not needed', env())
    const html = render(sop)
    expect(button(html, 'Reviewer Alpha', 'Remove Reviewer Alpha from this review')).not.toContain('aria-disabled="true"')
    expect(button(html, 'Reviewer Beta', 'Remove Reviewer Beta from this review')).toContain('aria-disabled="true"')
    expect(row(html, 'Reviewer Beta')).toContain('This reviewer declined the request.')
    expect(button(html, 'Reviewer Gamma', 'Remove Reviewer Gamma from this review')).toContain('aria-disabled="true"')
    expect(row(html, 'Reviewer Gamma')).toContain('Already removed.')
    // Co-authors don't see the author actions at all.
    expect(render(sop, false)).not.toContain('from this review')
  })

  it('shows Send Again, Edit and Delete on every row, disabled with a reason instead of a dash', () => {
    let sop = started()
    sop = acceptInternalReview(sop, 'alpha', currentInternalRound(sop)!.id, request(sop, 'alpha').id, env())
    const html = render(sop)
    for (const name of ['Reviewer Alpha', 'Reviewer Beta', 'Reviewer Gamma']) {
      for (const label of [`Send Again to ${name}`, `Remove ${name} from this review`]) expect(button(html, name, label)).toBeTruthy()
      expect(row(html, name)).toMatch(new RegExp(`aria-label="Edit Review (Deadline|Duration) for ${name}"`))
      expect(button(html, name, `Send Again to ${name}`)).toContain('aria-disabled="true"')
      expect(row(html, name)).toContain('Only an expired request can be sent again.')
      // No dash placeholders in the action cells.
      expect(row(html, name)).not.toMatch(/<td class="py-1.5 text-center"><span class="inline-flex size-9/)
    }
    // A disabled action can't be clicked: it is a button with aria-disabled and no handler, so it stays focusable for its tooltip.
    expect(button(html, 'Reviewer Beta', 'Send Again to Reviewer Beta')).toMatch(/^<button type="button" aria-disabled="true"/)
  })

  it('disables every action in an older version\'s table, as the review is no longer open', () => {
    const begun = started()
    const round = currentInternalRound(begun)!
    const older: Sop = { ...begun, version: '2', internalReviewRounds: [round, { ...round, id: 'second', version: '2', assignments: [] }] }
    const html = render(older)
    const olderTable = html.slice(html.indexOf(`id="review-requests-${round.id}"`))
    expect(button(olderTable, 'Reviewer Alpha', 'Send Again to Reviewer Alpha')).toContain('aria-disabled="true"')
    expect(button(olderTable, 'Reviewer Alpha', 'Remove Reviewer Alpha from this review')).toContain('aria-disabled="true"')
    expect(row(olderTable, 'Reviewer Alpha').match(/This review is no longer open\./g)!.length).toBe(3)
  })

  it('always shows the pencil to the main author: the deadline when accepted, the duration when pending', () => {
    let sop = started()
    sop = acceptInternalReview(sop, 'alpha', currentInternalRound(sop)!.id, request(sop, 'alpha').id, env())
    const pencil = (html: string, name: string, label = 'Edit Review Deadline') => row(html, name).match(new RegExp(`<button[^>]*aria-label="${label} for ${name}"[^>]*>`))![0]
    expect(pencil(render(sop), 'Reviewer Alpha')).not.toContain('aria-disabled="true"')
    expect(pencil(render(sop), 'Reviewer Beta', 'Edit Review Duration')).not.toContain('aria-disabled="true"')
    // Co-authors see neither Edit nor the other author actions.
    expect(render(sop, false)).not.toContain('Edit Review')
    expect(table(render(sop, false))).not.toContain('>Edit<')
  })

  it.each([
    ['completed', 'This reviewer completed the review.'],
    ['returned', 'This reviewer returned the review with comments.'],
  ] as const)('disables the pencil, with a tooltip, once the reviewer %s it', (decision, reason) => {
    let sop = started()
    sop = acceptInternalReview(sop, 'alpha', currentInternalRound(sop)!.id, request(sop, 'alpha').id, env())
    sop = decideInternalReview(sop, 'alpha', currentInternalRound(sop)!.id, request(sop, 'alpha').id, decision, decision === 'returned' ? 'Fix it' : undefined, env())
    const cell = row(render(sop), 'Reviewer Alpha')
    expect(cell.match(/<button[^>]*aria-label="Edit Review Deadline for Reviewer Alpha"[^>]*>/)![0]).toContain('aria-disabled="true"')
    expect(cell).toContain(reason)
  })

  it('disables the pencil for removed, declined and expired requests, and older versions', () => {
    const begun = started()
    const round = currentInternalRound(begun)!
    let sop = removeInternalReviewer(begun, 'author', round.id, request(begun, 'alpha').id, 'Not needed', env())
    sop = declineInternalReview(sop, 'beta', round.id, request(sop, 'beta').id, 'On leave', env())
    const html = render(sop)
    expect(row(html, 'Reviewer Alpha')).toContain('This reviewer was removed.')
    expect(row(html, 'Reviewer Beta')).toContain('This reviewer declined the request.')
    const expired = expireUnanswered(acceptInternalReview(begun, 'gamma', round.id, request(begun, 'gamma').id, env()), Date.parse(endOfRiyadhDay(request(begun, 'alpha').responseDueDate!)))
    expect(row(render(expired), 'Reviewer Alpha')).toContain('This request expired. Use Send Again instead.')
    const older: Sop = { ...begun, version: '2', internalReviewRounds: [round, { ...round, id: 'second', version: '2', assignments: [] }] }
    const olderTable = render(older).slice(render(older).indexOf(`id="review-requests-${round.id}"`))
    expect(olderTable).toContain('This review is no longer open.')
  })

  it('gives each action its own centered column, like the other tables', () => {
    const headers = table(render(started())).match(/<th scope="col" class="w-20 py-2 text-center font-medium">[^<]+<\/th>/g)!
    expect(headers.map((header) => header.replace(/<[^>]+>/g, ''))).toEqual(['Send Again', 'Edit', 'Delete'])
    expect(table(render(started(), false))).not.toMatch(/<th scope="col" class="w-20 py-2 text-center font-medium">/)
    // The phone cards show the same three, labelled.
    const cards = render(started()).slice(render(started()).indexOf('</table>'))
    expect(cards.match(/<span aria-hidden="true" class="text-xs font-medium text-text-gray">(Send Again|Edit|Delete)<\/span>/g)).toHaveLength(9)
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
  // Gamma accepted, so the SOP stays In Review once alpha and beta expire.
  function expired() {
    const begun = started(5)
    const sop = acceptInternalReview(begun, 'gamma', currentInternalRound(begun)!.id, request(begun, 'gamma').id, env())
    return expireUnanswered(sop, Date.parse(endOfRiyadhDay(sop.internalReviewRounds![0].assignments[0].responseDueDate!)))
  }
  it('shows the Expired label in lighter text, and the main author can remove the reviewer', () => {
    const html = render(expired())
    expect(table(html)).toContain('</span>Expired</span>')
    expect(table(html)).toMatch(/<tr class="text-text-gray"><th scope="row"[^>]*>Reviewer Alpha/)
    expect(row(html, 'Reviewer Alpha')).toContain('aria-label="Remove Reviewer Alpha from this review"')
    expect(render(expired(), false)).not.toContain('from this review')
  })
  it('offers Send Again to the main author only, enabled on the expired latest request', () => {
    const html = render(expired())
    expect(button(html, 'Reviewer Alpha', 'Send Again to Reviewer Alpha')).not.toContain('aria-disabled="true"')
    expect(render(expired(), false)).not.toContain('Send Again')
    const sop = expired()
    const sent = resendInternalReview(sop, 'author', request(sop, 'alpha').id, env())
    const rows = table(render(sent)).match(/<tr[^>]*><th scope="row"[^>]*>Reviewer Alpha.*?<\/tr>/g)!
    expect(rows).toHaveLength(1)
    // The new request is pending: Send Again stays visible, disabled.
    expect(rows[0].match(/<button[^>]*aria-label="Send Again to Reviewer Alpha"[^>]*>/)![0]).toContain('aria-disabled="true"')
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
  it('disables the trash icon on declined rows', () => {
    const sop = started(5)
    const declined = declineInternalReview(sop, 'alpha', currentInternalRound(sop)!.id, request(sop, 'alpha').id, 'On leave', env())
    expect(button(render(declined), 'Reviewer Alpha', 'Remove Reviewer Alpha from this review')).toContain('aria-disabled="true"')
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
