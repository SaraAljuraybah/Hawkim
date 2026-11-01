import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReviewTimelineTable } from '../components/workflow/ReviewTimelineTable'
import { sopWorkflowEn } from '../content/workflow.en'
import type { Sop, TimelineEvent, TimelineEventType } from '../data/mock/types'
import { visibleTimelineEvents } from './releaseScope'

const flag = vi.hoisted(() => ({ active: true }))
vi.mock('./releaseScope', async (original) => {
  const actual = await original<typeof import('./releaseScope')>()
  // The real filter, with the constant's value switchable for the table tests.
  return { ...actual, visibleTimelineEvents: (events: TimelineEvent[]) => actual.visibleTimelineEvents(events, flag.active) }
})
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ nameOf: () => 'Main Author' }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ nameOf: () => 'Home' }) }))

const shown: TimelineEventType[] = ['version-uploaded', 'version-deleted', 'co-author-added', 'co-author-removed', 'compliance-check-completed', 'compliance-check-failed', 'submitted', 'resubmitted', 'response', 'review-deadline-changed', 'review-expired']
const hidden: TimelineEventType[] = ['review-accepted', 'review-declined', 'review-completed', 'review-changes-requested', 'returned', 'review-returned', 'review-withdrawn', 'reviewer-removed', 'review-assigned', 'review-scope-decided', 'internal-review-completed', 'routed', 'stage-due-date-set', 'external-reviews-not-required', 'submitted-for-approval', 'forwarded-to-approver', 'approved-by', 'approved', 'published']
const all = [...hidden, ...shown]
const timeline = all.map((type, index): TimelineEvent => ({ id: `event-${index}`, type, actorId: 'author', version: '1', createdAt: `2026-10-01T08:${String(index).padStart(2, '0')}:00Z` }))
const sop = { id: 'sop', authorId: 'author', coAuthorIds: [], reviewers: [], approvers: [], comments: [], timeline } as unknown as Sop
const rows = (html: string) => html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>')).match(/<tr/g)?.length ?? 0

beforeEach(() => { flag.active = true })

describe('release 1 timeline scope', () => {
  it('covers every event type in the timeline labels', () => {
    expect([...all].sort()).toEqual(Object.keys(sopWorkflowEn.timeline.events).sort())
  })

  it('shows only the release 1 types while the constant is true, by type and not by position', () => {
    expect(visibleTimelineEvents(timeline).map((event) => event.type).sort()).toEqual([...shown].sort())
    expect(visibleTimelineEvents([...timeline].reverse()).map((event) => event.type)).toEqual([...shown].reverse())
  })

  it('hides a type that is not on the list, and leaves the data unchanged', () => {
    const before = structuredClone(timeline)
    expect(visibleTimelineEvents([{ ...timeline[0], type: 'future-type' as TimelineEventType }])).toEqual([])
    expect(timeline).toEqual(before)
  })

  it('shows everything while the constant is false', () => {
    flag.active = false
    expect(visibleTimelineEvents(timeline)).toEqual(timeline)
    expect(rows(renderToStaticMarkup(<ReviewTimelineTable sop={sop} content={sopWorkflowEn} mainAuthorOnly releaseScoped />))).toBe(all.length)
  })

  it('limits only the release-scoped table (the author page)', () => {
    expect(rows(renderToStaticMarkup(<ReviewTimelineTable sop={sop} content={sopWorkflowEn} mainAuthorOnly releaseScoped />))).toBe(shown.length)
  })

  it('keeps the hidden types on the review page table while the constant is true', () => {
    const html = renderToStaticMarkup(<ReviewTimelineTable sop={sop} content={sopWorkflowEn} />)
    expect(rows(html)).toBe(all.length)
    for (const type of ['review-declined', 'reviewer-removed', 'response', 'published'] as const) expect(html).toContain(`>${sopWorkflowEn.timeline.events[type]}<`)
  })
})
