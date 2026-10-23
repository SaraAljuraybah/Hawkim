import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Sop, User } from '../../data/mock/types'
import { sopWorkflowEn } from '../../content/workflow.en'
import { reviewFlowEn } from '../../content/reviewFlow.en'
import { SubmitDialog } from './SubmitDialog'
import { ReviewFlowSummary } from './ReviewFlowSummary'
import { ReviewFlowActions } from '../reviews/ReviewFlowActions'

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
  it('offers multiple eligible internal reviewers without assigning authors, external reviewers or approvers', () => {
    const html = renderToStaticMarkup(<SubmitDialog sop={draft()} content={sopWorkflowEn.dialogs} onSubmit={() => {}} onClose={() => {}} />)
    expect(html).toContain('name="internalReviewers"')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('First Test Reviewer')
    expect(html).toContain('Second Test Reviewer')
    expect(html).not.toContain('Other Department Reviewer')
    expect(html).not.toContain('Quality Test Controller')
    expect(html).not.toContain('Reviewer 1')
    expect(html).toContain('Overall Review Request Due Date')
    expect(html).toContain('type="date"')
  })
  it('shows a clear blocked Quality state when no controller is configured', () => {
    const sop: Sop = { ...draft(), status: 'in-review', reviewers: [{ userId: 'r1', decision: 'completed' }, { userId: 'r2', decision: 'completed' }], reviewFlow: { stage: 'quality-routing', activeReviewerId: 'r2', reviewer1Id: 'r1', reviewer2Id: 'r2', sameDivision: 'skipped', crossDivision: 'skipped', departments: [] } }
    const html = renderToStaticMarkup(<ReviewFlowActions sop={sop} onComplete={() => {}} />)
    expect(html).toContain(reviewFlowEn.qualityMissing)
    expect(html).toContain('disabled=""')
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
