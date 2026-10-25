import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { Sop, User } from '../../data/mock/types'
import { AddCoAuthorsDialog } from './AddCoAuthorsDialog'

const fixture = vi.hoisted(() => ({
  users: [
    { id: 'author', name: 'Main Author', permissions: ['author'], departmentId: 'home' },
    { id: 'writer', name: 'Other Writer', permissions: ['author'], departmentId: 'home' },
    { id: 'reviewing', name: 'Reviewing Writer', permissions: ['author', 'reviewer'], departmentId: 'home' },
    { id: 'approving', name: 'Approving Writer', permissions: ['author', 'approver'], departmentId: 'home' },
  ] as User[],
}))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: fixture.users, activeUsers: fixture.users }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ nameOf: () => 'Home' }) }))

function sop(): Sop {
  return { id: 'sop', code: 'SOP-1', title: 'SOP', departmentId: 'home', version: '1', status: 'in-review', authorId: 'author', coAuthorIds: [],
    lastUpdated: '2026-10-23', fileName: 'sop.pdf', fileType: 'pdf', versions: [], comments: [], timeline: [], complianceChecks: [],
    reviewers: [{ userId: 'reviewing', decision: 'pending' }], approvers: [{ userId: 'approving', decision: 'pending' }] }
}

describe('Add co-authors dialog', () => {
  const html = renderToStaticMarkup(<AddCoAuthorsDialog sop={sop()} content={sopWorkflowEn.dialogs} onSubmit={() => {}} onClose={() => {}} />)
  it('shows the short description and no hint about reviewers and approvers', () => {
    expect(html).toContain('Co-authors can upload versions and run compliance checks on their own uploads. Only you can submit for review.')
    expect(html).not.toContain('can’t be co-authors')
  })
  it('keeps the "Co-authors" label for screen readers only, linked to the search field with its placeholder', () => {
    const input = html.match(/<input[^>]*role="combobox"[^>]*>/)![0]
    const id = input.match(/id="([^"]+)"/)![1]
    expect(html).toContain(`<label for="${id}" class="sr-only">Co-authors</label>`)
    expect(input).toContain('placeholder="Search by name or department…"')
  })
  it('still leaves out the SOP’s reviewers and approvers', () => {
    expect(html).toContain('Other Writer')
    for (const name of ['Reviewing Writer', 'Approving Writer', 'Main Author']) expect(html).not.toContain(name)
  })
})
