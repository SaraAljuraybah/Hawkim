import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { Sop, TimelineEvent } from '../../data/mock/types'
import { visibleTimelineEvents } from '../../lib/releaseScope'
import { timelineNote } from '../../lib/reviewRequestRows'
import { ReviewNotesDialog } from './ReviewNotesDialog'
import { ReviewTimelineTable } from './ReviewTimelineTable'

const names: Record<string, string> = { author: 'Main Author', alpha: 'Reviewer Alpha', beta: 'Reviewer Beta' }
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ nameOf: (id: string) => names[id] ?? id }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ nameOf: () => 'Home' }) }))

const removed: TimelineEvent = { id: 'removed', type: 'reviewer-removed', actorId: 'author', recipientIds: ['alpha'], version: '1', createdAt: '2026-10-05T08:00:00Z', note: 'Not needed any more' }
const declined: TimelineEvent = { id: 'declined', type: 'review-declined', actorId: 'beta', recipientIds: ['author'], version: '1', createdAt: '2026-10-04T08:00:00Z', note: 'On leave' }
const submitted: TimelineEvent = { id: 'submitted', type: 'submitted', actorId: 'author', recipientIds: ['alpha', 'beta'], version: '1', createdAt: '2026-10-03T08:00:00Z', note: 'Please review' }
const sop = { id: 'sop', authorId: 'author', coAuthorIds: [], reviewers: [], approvers: [], comments: [], internalReviewRounds: [], timeline: [submitted, declined, removed] } as unknown as Sop
const author = () => renderToStaticMarkup(<ReviewTimelineTable sop={sop} content={sopWorkflowEn} mainAuthorOnly releaseScoped notePreview />)
const table = (html: string) => html.slice(html.indexOf('<table'), html.indexOf('</table>'))
const row = (html: string, action: string) => table(html).match(new RegExp(`<tr[^>]*><th scope="row"[^>]*>${action}.*?</tr>`))![0]

describe('removal and decline reasons in the author\'s Review Timeline', () => {
  it('lists Reviewer removed and Review declined on the author page (they were filtered out before)', () => {
    expect(visibleTimelineEvents([removed, declined], true).map((event) => event.type)).toEqual(['reviewer-removed', 'review-declined'])
    const html = author()
    for (const action of ['Reviewer removed', 'Review declined']) expect(table(html)).toContain(`>${action}<`)
  })

  it('adds a Preview column, last, styled like the other headings', () => {
    const headings = [...table(author()).matchAll(/<th scope="col"[^>]*>([^<]+)</g)].map((match) => match[1])
    expect(headings).toEqual(['Action', 'By', 'To', 'Date', 'Version', 'Comment', 'Preview'])
  })

  it('puts each reason behind an eye named for the reviewer, with — in Comment', () => {
    const html = author()
    expect(row(html, 'Reviewer removed')).toContain('aria-label="View the Reason for Removing Reviewer Alpha"')
    expect(row(html, 'Review declined')).toContain('aria-label="View the Reason Reviewer Beta Declined"')
    for (const action of ['Reviewer removed', 'Review declined']) expect(row(html, action)).toMatch(/<td class="py-3 pr-4"><span aria-hidden="true" class="text-text-gray">—<\/span>/)
    expect(table(html)).not.toContain('Not needed any more')
    expect(table(html)).not.toContain('On leave')
  })

  it('keeps other comments in Comment, with no eye', () => {
    const html = author()
    expect(row(html, 'Submitted for review')).toContain('Please review')
    expect(row(html, 'Submitted for review')).not.toContain('lucide-eye')
  })

  it('shows the eye in the phone cards too', () => {
    const cards = author().slice(author().indexOf('</table>'))
    expect(cards.match(/lucide-eye/g)).toHaveLength(2)
    expect(cards).toContain('View the Reason for Removing Reviewer Alpha')
  })

  it('opens the same dialog as before, with only the reason and its date', () => {
    expect(timelineNote(sop, removed)).toEqual({ type: 'reviewer-removed', reviewerId: 'alpha', note: { kind: 'removal', text: 'Not needed any more', date: '2026-10-05T08:00:00Z' } })
    expect(timelineNote(sop, declined)).toEqual({ type: 'review-declined', reviewerId: 'beta', note: { kind: 'decline', text: 'On leave', date: '2026-10-04T08:00:00Z' } })
    expect(timelineNote(sop, submitted)).toBeUndefined()
    expect(timelineNote(sop, { ...removed, note: undefined })).toBeUndefined()
    const reason = timelineNote(sop, removed)!
    const dialog = renderToStaticMarkup(<ReviewNotesDialog title={sopWorkflowEn.timeline.notePreview.title[reason.type].replace('{name}', 'Reviewer Alpha')}
      notes={[reason.note]} labels={{ comment: 'Comments', decline: 'Reason for Declining', removal: 'Reason for Removing' }} closeLabel="Close" onClose={() => {}} />)
    for (const text of ['Reason for Removing Reviewer Alpha', '>Reason for Removing<', 'Not needed any more', 'Oct 5, 2026', '>Close<']) expect(dialog).toContain(text)
    expect(dialog).not.toContain('>Comments<')
  })

  it('leaves the review page\'s timeline as it was: reasons in Comment, no Preview column', () => {
    const html = renderToStaticMarkup(<ReviewTimelineTable sop={sop} content={sopWorkflowEn} />)
    expect(table(html)).not.toContain('>Preview<')
    expect(table(html)).toContain('Not needed any more')
    expect(table(html)).toContain('On leave')
  })
})

describe('review comments in the author\'s Review Timeline', () => {
  const returned = { id: 'req-alpha', userId: 'alpha', decision: 'returned', assignedAt: '2026-10-03T08:00:00Z', commentId: 'c-alpha' }
  const completed = { id: 'req-beta', userId: 'beta', decision: 'completed', assignedAt: '2026-10-03T08:00:00Z' }
  const commented = { ...sop, status: 'in-review', comments: [{ id: 'c-alpha', version: '1', authorId: 'alpha', authorUserId: 'alpha', role: 'reviewer', text: 'Please revise section 2', createdAt: '2026-10-06T08:00:00Z' }],
    internalReviewRounds: [{ id: 'round', scope: 'internal', version: '1', status: 'changes-requested', assignments: [returned, completed] }],
    timeline: [submitted,
      { id: 'ret', type: 'review-changes-requested', actorId: 'alpha', recipientIds: ['author'], version: '1', createdAt: '2026-10-06T08:00:00Z', commentId: 'c-alpha', reviewAssignmentId: 'req-alpha' },
      { id: 'done', type: 'review-completed', actorId: 'beta', recipientIds: ['author'], version: '1', createdAt: '2026-10-07T08:00:00Z', reviewAssignmentId: 'req-beta' }] } as unknown as Sop
  const html = () => renderToStaticMarkup(<ReviewTimelineTable sop={commented} content={sopWorkflowEn} mainAuthorOnly releaseScoped notePreview />)

  it('lists completed and returned reviews, with the comments behind an eye and — in Comment', () => {
    expect(row(html(), 'Returned with comments')).toContain('aria-label="View Comments from Reviewer Alpha"')
    expect(table(html())).not.toContain('Please revise section 2')
    expect(row(html(), 'Returned with comments')).toMatch(/<td class="py-3 pr-4"><span aria-hidden="true" class="text-text-gray">—<\/span>/)
  })

  it('shows — in Preview when a review was completed without comments', () => {
    expect(row(html(), 'Review completed')).not.toContain('lucide-eye')
  })

  it('opens the comment with its date and offers Response for that reviewer, as the Reviewers table did', () => {
    const note = timelineNote(commented, commented.timeline[1])!
    expect(note).toMatchObject({ reviewerId: 'alpha', note: { kind: 'comment', text: 'Please revise section 2', date: '2026-10-06T08:00:00Z' }, request: { id: 'req-alpha' } })
    const dialog = renderToStaticMarkup(<ReviewNotesDialog title={sopWorkflowEn.timeline.notePreview.title[note.type].replace('{name}', 'Reviewer Alpha')} notes={[note.note]}
      labels={{ comment: 'Comments', decline: 'Reason for Declining', removal: 'Reason for Removing' }} closeLabel="Close" onClose={() => {}}
      response={{ recipients: 'Reviewer Alpha (Reviewer)', onSend: async () => {} }} />)
    for (const text of ['Comments from Reviewer Alpha', '>Comments<', 'Please revise section 2', 'Oct 6, 2026', '>Response<']) expect(dialog).toContain(text)
  })

  it('keeps comments inline on the review page, as before', () => {
    const review = renderToStaticMarkup(<ReviewTimelineTable sop={commented} content={sopWorkflowEn} />)
    expect(table(review)).toContain('Please revise section 2')
    expect(table(review)).not.toContain('>Preview<')
  })
})
