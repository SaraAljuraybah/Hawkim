import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { mySopsEn } from '../../content/mySops.en'
import type { InternalReviewDecision, InternalReviewerAssignment, InternalReviewRound, Sop, TimelineEvent } from '../../data/mock/types'
import { filterMySops } from '../../lib/mySops'
import { authorStatus, returnedStep } from '../../lib/workflow'
import type { SopStatus } from '../../types/status'
import { AuthoredSopGrid } from './AuthoredSopGrid'
import { AuthoredSopList } from './AuthoredSopList'

vi.mock('../../state/guidelinesContext', () => ({ useGuidelines: () => ({ current: { version: '4.0' } }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [] }) }))

const request = (userId: string, decision: InternalReviewDecision): InternalReviewerAssignment =>
  ({ id: `${userId}-${decision}`, userId, decision, assignedAt: '2026-11-01T09:00:00Z', assignedDueDays: null }) as InternalReviewerAssignment
const round = (status: InternalReviewRound['status'], version: string, assignments: InternalReviewerAssignment[]): InternalReviewRound => ({
  id: `round-${version}`, scope: 'internal', version, status, requestedById: 'me', requestedAt: '2026-11-01T09:00:00Z', assignedDueDays: null, assignments,
})
const returnedBy = (actorId: string): TimelineEvent => ({ id: 'evt-return', type: 'returned', actorId, version: '1', createdAt: '2026-11-02T09:00:00Z' })

function sop(id: string, status: SopStatus, extra: Partial<Sop> = {}): Sop {
  return {
    id, code: 'SOP-001', title: `${id} procedure`, authorId: 'me', coAuthorIds: [], departmentId: 'home', status, version: '1',
    lastUpdated: '2026-11-01', fileName: 'a.pdf', fileType: 'pdf', versions: [], reviewers: [], approvers: [{ userId: 'approver', decision: 'pending' }],
    timeline: [], comments: [], complianceChecks: [], ...extra,
  }
}

const sops = {
  reviewing: sop('reviewing', 'in-review', { internalReviewRounds: [round('open', '1', [request('a', 'accepted'), request('b', 'completed')])] }),
  oneReturned: sop('one-returned', 'in-review', { internalReviewRounds: [round('open', '1', [request('a', 'returned'), request('b', 'accepted')])] }),
  changesRequested: sop('changes-requested', 'in-review', { internalReviewRounds: [round('changes-requested', '1', [request('a', 'returned'), request('b', 'completed')])] }),
  newRound: sop('new-round', 'in-review', {
    version: '2', internalReviewRounds: [round('changes-requested', '1', [request('a', 'returned')]), round('open', '2', [request('a', 'pending')])],
  }),
  approverReturned: sop('approver-returned', 'returned', { timeline: [returnedBy('approver')] }),
  inApproval: sop('in-approval', 'in-approval'),
  draft: sop('draft', 'draft'),
  published: sop('published', 'published'),
}

describe('authorStatus', () => {
  it('is Returned as soon as one reviewer of the current round returned the SOP', () => {
    expect(authorStatus(sops.reviewing)).toBe('in-review')
    expect(authorStatus(sops.oneReturned)).toBe('returned')
    expect(authorStatus(sops.changesRequested)).toBe('returned')
  })

  it('is In Review again once a new version starts a new round', () => {
    expect(authorStatus(sops.newRound)).toBe('in-review')
  })

  it('keeps every other status as stored, including an approver return', () => {
    expect(authorStatus(sops.approverReturned)).toBe('returned')
    expect(authorStatus(sops.inApproval)).toBe('in-approval')
    expect(authorStatus(sops.draft)).toBe('draft')
    expect(authorStatus(sops.published)).toBe('published')
  })

  it('always agrees with the Workflow status steps', () => {
    for (const item of Object.values(sops)) expect(authorStatus(item) === 'returned').toBe(returnedStep(item) !== undefined)
  })

  it("doesn't change the stored status or the In Progress tab", () => {
    const before = structuredClone(sops.oneReturned)
    authorStatus(sops.oneReturned)
    expect(sops.oneReturned).toEqual(before)
    const progress = filterMySops([sops.oneReturned, sops.newRound], 'me', { category: 'progress' }).map((item) => item.id)
    expect(progress).toEqual(['one-returned', 'new-round'])
  })
})

/** Each SOP's badge (rendered on its own): its colour classes and label, by SOP title. */
function badges(render: (items: Sop[]) => ReactElement, items: Sop[]): Record<string, { colours: string; label: string }> {
  return Object.fromEntries(items.map((item) => {
    const markup = renderToStaticMarkup(<MemoryRouter>{render([item])}</MemoryRouter>)
    const badge = markup.match(/whitespace-nowrap (bg-\S+ text-\S+) "><span aria-hidden="true" class="size-1.5 rounded-full bg-current"><\/span>([^<]+)</)!
    return [item.title, { colours: badge[1], label: badge[2] }]
  }))
}

describe.each([
  ['grid', (items: Sop[]) => <AuthoredSopGrid sops={items} content={mySopsEn} userId="me" />],
  ['list', (items: Sop[]) => <AuthoredSopList sops={items} content={mySopsEn} userId="me" />],
] as const)('the status badge in the My SOPs %s view', (_view, render) => {
  it('shows Returned in red once one reviewer returned it, like an approver return', () => {
    const shown = badges(render, [sops.oneReturned, sops.changesRequested, sops.approverReturned])
    for (const item of [sops.oneReturned, sops.changesRequested, sops.approverReturned]) {
      expect(shown[item.title]).toEqual({ colours: 'bg-status-rejected-bg text-status-rejected-fg', label: 'Returned' })
    }
  })

  it('shows In Review while reviewers are working, and again after a new round starts', () => {
    const shown = badges(render, [sops.reviewing, sops.newRound])
    expect(shown[sops.reviewing.title]).toEqual({ colours: 'bg-status-pending-bg text-status-pending-fg', label: 'In Review' })
    expect(shown[sops.newRound.title]).toEqual({ colours: 'bg-status-pending-bg text-status-pending-fg', label: 'In Review' })
  })
})
