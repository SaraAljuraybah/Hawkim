import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { internalReviewEn } from '../../content/internalReview.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { Department, Sop, User } from '../../data/mock/types'
import { SubmitDialog } from './SubmitDialog'
// These tests cover the Riyadh working-day policy as it behaves once activated (lib/deadlinePolicy.ts).
// The pending (currently active) backend-compatible behaviour is covered in lib/deadlinePolicy.test.tsx.
vi.mock('../../lib/deadlinePolicy', () => ({ WORKING_DAY_DEADLINES_ACTIVE: true }))

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
  it('marks Division, Department and Reviewers required, with a red asterisk, in every mode; the optional fields stay unmarked', () => {
    const asterisk = '<span aria-hidden="true" class="ml-0.5 text-status-rejected-fg">*</span>'
    for (const mode of ['submit', 'add', 'version'] as const) {
      const html = renderToStaticMarkup(<SubmitDialog sop={draft()} content={sopWorkflowEn.dialogs} mode={mode} onClose={() => {}} onSubmit={() => {}} />)
      const label = (text: string) => html.match(new RegExp(`<label[^>]*>${text.replace(/[()]/g, '\\$&')}(<span[^>]*>\\*</span>)?</label>`))![0]
      for (const text of ['Division', 'Department', 'Reviewers']) expect(label(text)).toContain(asterisk)
      for (const name of ['reviewDivision', 'reviewDepartment']) expect(html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))![0]).toContain('required=""')
      expect(html.match(/<input[^>]*placeholder="Search reviewers by name…"[^>]*>/)![0]).toContain('aria-required="true"')
      for (const text of ['Review Duration in Working Days (Optional)', 'Comments (Optional)']) expect(label(text)).not.toContain('*')
      expect(html.match(/<input[^>]*name="reviewDurationDays"[^>]*>/)![0]).not.toContain('required')
      expect(html.match(/<textarea[^>]*name="note"[^>]*>/)![0]).not.toContain('required')
    }
  })

  it('starts the searchable Division, then Department, on the SOP\'s own, before the reviewers', () => {
    const html = render()
    const department = html.match(/<input[^>]*name="reviewDepartment"[^>]*>/)![0]
    const division = html.match(/<input[^>]*name="reviewDivision"[^>]*>/)![0]
    for (const input of [division, department]) {
      expect(input).toContain('role="combobox"')
      expect(input).not.toContain('readOnly')
    }
    expect(department).toContain('value="Home Department"')
    expect(division).toContain('value="configured-division"')
    expect(html).toContain('aria-label="Show divisions"')
    expect(html).toContain('aria-label="Show departments"')
    expect(html.indexOf('name="reviewDivision"')).toBeLessThan(html.indexOf('name="reviewDepartment"'))
    expect(html.indexOf('name="reviewDepartment"')).toBeLessThan(html.indexOf('Search reviewers by name…'))
    // The department list holds the chosen division's departments; no separate reviewer department filter.
    expect(html).not.toContain('Other Department')
    expect(html).not.toContain('Reviewer Department')
    expect(html).not.toContain('All Departments')
  })

  it('offers "No Division" for a department without one', () => {
    const configured = fixture.departments[0].divisionId
    try {
      delete fixture.departments[0].divisionId
      const html = render()
      expect(html.match(/<input[^>]*name="reviewDivision"[^>]*>/)![0]).toContain(`value="${internalReviewEn.submit.noDivision}"`)
      // Both departments are without a division now, so both are listed.
      expect(html).toContain('Other Department')
    } finally { fixture.departments[0].divisionId = configured }
  })

  it('labels the reviewer picker visibly and gives it a chevron that opens the list', () => {
    const html = render()
    const input = html.match(/<input[^>]*placeholder="Search reviewers by name…"[^>]*>/)![0]
    const label = html.match(/<label[^>]*for="([^"]+)"[^>]*>Reviewers(?:<span[^>]*>\*<\/span>)?<\/label>/)!
    expect(label[0]).not.toContain('sr-only')
    expect(input).toContain(`id="${label[1]}"`)
    const toggle = html.match(/<button[^>]*aria-label="Show reviewers"[^>]*>/)![0]
    expect(toggle).toContain('tabindex="-1"')
    expect(toggle).toContain(`aria-controls="${input.match(/aria-controls="([^"]+)"/)![1]}"`)
  })

  it('keeps the due date preview empty, in a polite live region, until a valid duration is typed', () => {
    const html = render()
    expect(html).toMatch(/<p aria-live="polite" class="[^"]*"><\/p>/)
    expect(html).not.toContain('Latest due date')
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

  it('asks only for the optional review duration: the server sets the response deadline', () => {
    const html = render()
    expect(html).not.toContain('name="reviewRequestDueDate"')
    expect(html).not.toContain('type="date"')
    expect(html).not.toContain('Friday and Saturday are excluded')
    expect(html).toContain('The reviewer has 2 working days to accept. The review duration starts when they accept (weekends excluded).')
    expect(html.match(/<input[^>]*name="reviewDurationDays"[^>]*>/)![0]).toContain('min="1" max="3650"')
    expect(html).not.toContain('The server sets the final date when you submit')
  })

  it('allows 500-character submission comments with a counter and the shared limit', () => {
    const html = render()
    expect(html.match(/<textarea[^>]*name="note"[^>]*>/)![0]).toContain('maxLength="500"')
    expect(html).toContain('0 / 500')
    expect(html).not.toContain('Add comments of up to 500 characters.')
    expect(html).not.toContain('1000 characters')
    expect(html).toContain('Submit for Review')
    expect(html).not.toContain('SOP-PRIVATE')
  })
})
