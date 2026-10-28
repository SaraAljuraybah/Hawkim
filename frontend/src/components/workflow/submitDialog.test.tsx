import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { internalReviewEn } from '../../content/internalReview.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { Department, Sop, User } from '../../data/mock/types'
import { SubmitDialog } from './SubmitDialog'

const fixture = vi.hoisted(() => ({
  departments: [{ id: 'home', name: 'Home Department', initials: 'HD', description: '', divisionId: 'configured-division' },
    { id: 'foreign', name: 'Other Department', initials: 'OD', description: '' }] as Department[],
  users: [
    { id: 'author', name: 'Main Writer', departmentId: 'home', permissions: ['author', 'reviewer'] },
    { id: 'coauthor', name: 'Co Writer', departmentId: 'home', permissions: ['author', 'reviewer'] },
    { id: 'r1', name: 'First Eligible Reviewer', departmentId: 'home', permissions: ['reviewer'] },
    { id: 'r2', name: 'Second Eligible Reviewer', departmentId: 'home', permissions: ['reviewer'] },
    { id: 'foreign', name: 'Foreign Reviewer', departmentId: 'foreign', permissions: ['reviewer'] },
    { id: 'admin', name: 'Administrator', departmentId: 'home', permissions: ['admin', 'reviewer'] },
    { id: 'deleted', name: 'Removed User', departmentId: 'home', permissions: ['reviewer'], deletedAt: '2026-10-01' },
  ] as User[],
}))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ activeUsers: fixture.users }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ departments: fixture.departments }) }))

function draft(): Sop {
  return { id: 'sop', code: 'SOP-PRIVATE', title: 'Reviewable SOP', departmentId: 'home', authorId: 'author', coAuthorIds: ['coauthor'],
    version: '1', status: 'draft', lastUpdated: '2026-10-28', fileName: 'document.pdf', fileType: 'pdf',
    versions: [], comments: [], timeline: [], reviewers: [], approvers: [], complianceChecks: [] }
}
const render = () => renderToStaticMarkup(<SubmitDialog sop={draft()} content={sopWorkflowEn.dialogs} onClose={() => {}} onSubmit={() => {}} />)

beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-29T09:00:00+03:00') }))
afterEach(() => vi.useRealTimers())

describe('Submit for Review safe frontend presentation', () => {
  it('locks the department and its actual configured division before searchable reviewer selection', () => {
    const html = render()
    const department = html.match(/<input[^>]*name="reviewDepartment"[^>]*>/)![0]
    const division = html.match(/<input[^>]*name="reviewDivision"[^>]*>/)![0]
    expect(department).toContain('readOnly=""')
    expect(department).toContain('value="Home Department"')
    expect(division).toContain('readOnly=""')
    expect(division).toContain('value="configured-division"')
    expect(html.indexOf('name="reviewDepartment"')).toBeLessThan(html.indexOf('name="reviewDivision"'))
    expect(html.indexOf('name="reviewDivision"')).toBeLessThan(html.indexOf('role="combobox"'))
    expect(html).toContain('Cross-department requests are not available in this review flow.')
    expect(html).not.toContain('Other Department')
  })

  it('does not invent divisions when none is configured', () => {
    const configured = fixture.departments[0].divisionId
    try {
      delete fixture.departments[0].divisionId
      expect(render()).toContain(`value="${internalReviewEn.submit.noDivision}"`)
    } finally { fixture.departments[0].divisionId = configured }
  })

  it('exposes only eligible reviewer options in an accessible searchable picker', () => {
    const html = render()
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-autocomplete="list"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('placeholder="Search reviewers by name…"')
    expect(html).toContain('First Eligible Reviewer')
    expect(html).toContain('Second Eligible Reviewer')
    for (const excluded of ['Main Writer', 'Co Writer', 'Foreign Reviewer', 'Administrator', 'Removed User']) expect(html).not.toContain(excluded)
  })

  it('shows a nonempty fixed two-working-date allocation independently of review duration', () => {
    const html = render()
    const date = html.match(/<input[^>]*name="reviewRequestDueDate"[^>]*>/)![0]
    expect(date).toContain('readOnly=""')
    expect(date).not.toContain('disabled=')
    expect(date).toContain('value="2026-11-02"')
    expect(html).toContain(internalReviewEn.submit.responseHelp)
    expect(html).toContain('Friday and Saturday are excluded')
    expect(html).toContain(internalReviewEn.submit.durationHelp)
    expect(html.match(/<input[^>]*name="reviewDurationDays"[^>]*>/)![0]).toContain('min="1" max="30"')
    expect(html).toContain('calendar days, including weekends')
  })

  it('allows 1000-character submission comments with a counter and the shared limit', () => {
    const html = render()
    expect(html.match(/<textarea[^>]*name="note"[^>]*>/)![0]).toContain('maxLength="1000"')
    expect(html).toContain('0 / 1000')
    expect(html).toContain(internalReviewEn.submit.noteHelp)
    expect(html).not.toContain('500 characters')
    expect(html).toContain('Submit for Review')
    expect(html).not.toContain('SOP-PRIVATE')
  })
})
