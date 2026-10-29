import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Sop, User } from '../../data/mock/types'
import { sopWorkflowEn } from '../../content/workflow.en'
import { reviewFlowEn } from '../../content/reviewFlow.en'
import { SubmitDialog } from './SubmitDialog'
import { ReviewFlowSummary } from './ReviewFlowSummary'
import { ReviewFlowActions } from '../reviews/ReviewFlowActions'
import { ReviewDueDateField } from './ReviewDueDateField'

const fixtures = vi.hoisted(() => ({
  users: [
    { id: 'r1', name: 'First Test Reviewer', departmentId: 'test-origin', permissions: ['reviewer'] },
    { id: 'r2', name: 'Second Test Reviewer', departmentId: 'test-origin', permissions: ['reviewer'] },
    { id: 'other', name: 'Other Department Reviewer', departmentId: 'other-dept', permissions: ['reviewer'] },
    { id: 'qdc', name: 'Quality Test Controller', departmentId: 'quality', permissions: ['approver'] },
  ] as User[],
  departments: [{ id: 'test-origin', name: 'Test Department', initials: 'TD', description: '' }],
}))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: fixtures.users, activeUsers: fixtures.users, nameOf: (id: string) => fixtures.users.find((u) => u.id === id)?.name ?? id }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ departments: fixtures.departments, nameOf: (id: string) => id }) }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ reviewAction: vi.fn() }) }))
function draft(): Sop {
  return { id: 'test', code: 'TEST', title: 'Test', departmentId: 'test-origin', version: '1', status: 'draft', authorId: 'author', coAuthorIds: [], lastUpdated: '2026-10-18', fileName: 'test.pdf', fileType: 'pdf', reviewers: [], approvers: [], versions: [], comments: [], timeline: [], complianceChecks: [] }
}
describe('review plan interface', () => {
  it('offers searchable eligible internal reviewers without external reviewers or approvers', () => {
    const html = renderToStaticMarkup(<SubmitDialog sop={draft()} content={sopWorkflowEn.dialogs} onSubmit={() => {}} onClose={() => {}} />)
    expect(html).toContain('Select reviewers')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('role="combobox"')
    expect(html.match(/<ul[^>]*role="listbox"[^>]*>/)?.[0]).toContain('hidden=""')
    expect(html).toContain('placeholder="Search reviewers by name…"')
    expect(html).toContain('First Test Reviewer')
    expect(html).toContain('Second Test Reviewer')
    expect(html).not.toContain('Other Department Reviewer')
    expect(html).not.toContain('Quality Test Controller')
    expect(html).not.toContain('Reviewer 1')
    expect(html).toContain('Request response deadline')
    expect(html.match(/type="date"/g)).toHaveLength(1)
    expect(html.match(/<input[^>]*name="reviewRequestDueDate"[^>]*>/)?.[0]).toContain('readOnly=""')
    expect(html).toContain('Review duration in working days (optional)')
    expect(html).not.toContain('Individual Reviewer Task Due Date')
  })
  it('shows a clear blocked Quality state when no controller is configured', () => {
    const sop: Sop = { ...draft(), status: 'in-review', reviewers: [{ userId: 'r1', decision: 'completed' }, { userId: 'r2', decision: 'completed' }], reviewFlow: { stage: 'quality-routing', activeReviewerId: 'r2', reviewer1Id: 'r1', reviewer2Id: 'r2', sameDivision: 'skipped', crossDivision: 'skipped', departments: [] } }
    const html = renderToStaticMarkup(<ReviewFlowActions sop={sop} onComplete={() => {}} />)
    expect(html).toContain(reviewFlowEn.qualityMissing)
    expect(html).toContain(reviewFlowEn.authorRoutingPending)
    expect(html).not.toContain('>' + reviewFlowEn.routeQuality + '</button>')
    expect(html).not.toContain('Take this task')
  })
  it('displays required department assignments and their completion state', () => {
    const sop: Sop = { ...draft(), status: 'in-review', reviewFlow: { stage: 'same-division-representative', activeReviewerId: 'other', reviewer1Id: 'r1', reviewer2Id: 'r2', sameDivision: 'required', crossDivision: 'pending', departments: [{ departmentId: 'other-dept', scope: 'same-division', representativeId: 'other', completed: false }] } }
    const html = renderToStaticMarkup(<ReviewFlowSummary sop={sop} />)
    expect(html).toContain(reviewFlowEn.stages['same-division-representative'])
    expect(html).toContain('Other Department Reviewer')
    expect(html).toContain(reviewFlowEn.pending)
  })
})

afterEach(() => vi.useRealTimers())

describe('review date field policy and accessible allocation preview', () => {
  function field(value: string, stage?: 'review' | 'approval', error?: string) {
    return renderToStaticMarkup(<ReviewDueDateField name="deadline" text={sopWorkflowEn.dialogs.submit.reviewDate}
      value={value} stage={stage} error={error} onChange={() => {}} />)
  }

  it('allows today with a precise partial-day allocation and no maximum', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 24, 12, 34, 56, 789) })
    const html = field('2026-10-24')
    const input = html.match(/<input[^>]*>/)![0]
    expect(input).toContain('min="2026-10-24"')
    expect(input).not.toContain('max=')
    expect(input).not.toContain('required=')
    expect(input).toContain('aria-describedby=')
    expect(html).toContain('Time given: 11 hours 25 minutes')
    expect(html).not.toContain('Time given: 0 days')
    expect(html).not.toContain('Time given: 1 day')
    expect(html).toContain(sopWorkflowEn.dialogs.submit.reviewDate.help)
    expect(html).not.toContain('23:59:59.999')
  })

  it('previews dates beyond 30 days without adding a maximum', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 24, 12) })
    const html = field('2026-12-25')
    expect(html).toContain('Time given: 62 days 11 hours')
    expect(html.match(/<input[^>]*>/)![0]).not.toContain('max=')
  })

  it('keeps the date optional and does not show allocations for blank, past, or invalid dates', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 24, 12) })
    for (const value of ['', '2026-10-23', '2026-02-30', 'not-a-date']) {
      expect(field(value)).not.toContain('Time given:')
    }
    const html = field('2026-10-23', 'review', 'Choose today or a future date.')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('Choose today or a future date.')
  })

  it('retains tomorrow through 30 days for approval without changing its allocation preview', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 24, 12) })
    const html = field('2026-10-25', 'approval')
    expect(html).toContain('min="2026-10-25"')
    expect(html).toContain('max="2026-11-23"')
    expect(html).toContain('Time given: 1 day')
    expect(field('2026-10-24', 'approval')).not.toContain('Time given:')
    expect(field('2026-11-24', 'approval')).not.toContain('Time given:')
  })
})
