import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { ReviewFlowStage, Sop, User } from '../../data/mock/types'
import { reviewFlowEn } from '../../content/reviewFlow.en'
import { ReviewFlowActions } from './ReviewFlowActions'

const fixture = vi.hoisted(() => ({
  dialog: null as 'forward' | null,
  target: undefined as string | undefined,
  confirm: undefined as (() => unknown) | undefined,
  reviewAction: vi.fn(),
  users: [
    { id: 'r1', name: 'First reviewer', departmentId: 'home', permissions: ['reviewer'] },
    { id: 'r2', name: 'Assigned second reviewer', departmentId: 'home', permissions: ['reviewer'] },
    { id: 'representative', name: 'Department representative', departmentId: 'other', permissions: ['reviewer'] },
    { id: 'assigned-other', name: 'Assigned department reviewer', departmentId: 'other', permissions: ['reviewer'] },
  ] as User[],
}))
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>()
  return { ...react, useState: (initial: unknown) => react.useState(initial === null ? fixture.dialog : initial === undefined ? fixture.target : initial) }
})
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ reviewAction: fixture.reviewAction }) }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: fixture.users }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [{ id: 'home', divisionId: 'division' }, { id: 'other', divisionId: 'division' }] }) }))
vi.mock('../ui/FormDialog', () => ({ FormDialog: ({ children, onConfirm }: { children: ReactNode; onConfirm: () => unknown }) => {
  fixture.confirm = onConfirm
  return <div>{children}</div>
} }))

function sop(stage: ReviewFlowStage = 'reviewer-1'): Sop {
  return { id: 'legacy', code: 'SOP-123', title: 'Existing review', departmentId: 'home', version: '1', status: 'in-review', authorId: 'author', coAuthorIds: [], lastUpdated: '2026-10-29', fileName: 'review.pdf', fileType: 'pdf',
    reviewers: [{ userId: 'r1', decision: 'pending' }, { userId: 'r2', decision: 'pending', dueDate: '2026-10-30', assignedDueDays: 1 }], approvers: [], versions: [], comments: [], timeline: [], complianceChecks: [],
    reviewFlow: { stage, activeReviewerId: 'r1', reviewer1Id: 'r1', reviewer2Id: 'r2', sameDivision: 'pending', crossDivision: 'pending', departments: [] },
  }
}
function render(item: Sop) { return renderToStaticMarkup(<ReviewFlowActions sop={item} onComplete={() => {}} />) }

beforeEach(() => {
  fixture.dialog = null
  fixture.target = undefined
  fixture.confirm = undefined
  fixture.reviewAction.mockReset()
})

describe('legacy reviewer assignment controls', () => {
  it('does not let the initial reviewer select a new reviewer', () => {
    const item = sop()
    item.reviewFlow!.reviewer2Id = undefined
    item.reviewers = [item.reviewers[0]]
    const html = render(item)
    expect(html).not.toContain(reviewFlowEn.forward)
    expect(html).not.toContain('<select')
    expect(html).toContain(reviewFlowEn.authorRoutingPending)
    expect(html).toContain(reviewFlowEn.returnAuthor)
  })

  it('allows an existing reviewer handoff without selection or deadline edits', () => {
    fixture.dialog = 'forward'
    fixture.target = 'r2'
    const item = sop()
    const before = JSON.stringify(item)
    const html = render(item)
    expect(html).toContain(reviewFlowEn.forward)
    expect(html).toContain('Assigned second reviewer')
    expect(html.match(/<input[^>]*name="existingReviewer"[^>]*>/)?.[0]).toContain('readOnly=""')
    expect(html).not.toContain('<select')
    expect(html).not.toContain('type="date"')
    fixture.confirm!()
    expect(fixture.reviewAction).toHaveBeenCalledWith('legacy', { type: 'forward', reviewerId: 'r2', text: '' })
    expect(JSON.stringify(item)).toBe(before)
  })

  it('does not turn a saved reviewer id without an existing assignment into a handoff', () => {
    const item = sop()
    item.reviewers = [item.reviewers[0]]
    expect(render(item)).not.toContain(reviewFlowEn.forward)
  })

  it('does not reactivate a cancelled reviewer assignment', () => {
    const item = sop()
    item.reviewers[1].decision = 'cancelled'
    expect(render(item)).not.toContain(reviewFlowEn.forward)
  })

  it('rejects a stale open handoff if its assigned target changed', () => {
    fixture.dialog = 'forward'
    fixture.target = 'previous-reviewer'
    render(sop())
    expect(fixture.confirm!()).toBe(false)
    expect(fixture.reviewAction).not.toHaveBeenCalled()
  })

  it.each(['same-division-decision', 'cross-division-decision', 'quality-routing'] as const)('leaves %s routing to the Author', (stage) => {
    const html = render(sop(stage))
    expect(html).toContain(reviewFlowEn.authorRoutingPending)
    expect(html).not.toContain(`>${reviewFlowEn.departmentReview}</button>`)
    expect(html).not.toContain(`>${reviewFlowEn.skip}</button>`)
    expect(html).not.toContain(`>${reviewFlowEn.routeQuality}</button>`)
    expect(html).toContain(reviewFlowEn.returnAuthor)
  })

  it('preserves the already assigned department reviewer handoff', () => {
    const item = sop('same-division-representative')
    item.reviewFlow!.departments = [{ departmentId: 'other', scope: 'same-division', representativeId: 'representative', reviewerId: 'assigned-other', completed: false }]
    item.reviewers.push({ userId: 'assigned-other', decision: 'pending' })
    expect(render(item)).toContain(reviewFlowEn.forward)
    item.reviewFlow!.departments[0].reviewerId = undefined
    expect(render(item)).not.toContain(reviewFlowEn.forward)
  })

  it('keeps existing Reviewer 2 completion and return decisions available', () => {
    const html = render(sop('reviewer-2'))
    expect(html).toContain(reviewFlowEn.complete)
    expect(html).toContain(reviewFlowEn.returnReview)
    expect(html).toContain(reviewFlowEn.returnAuthor)
  })
})
