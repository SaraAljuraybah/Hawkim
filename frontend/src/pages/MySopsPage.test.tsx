import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Sop, User } from '../data/mock/types'
import { mySopsEn } from '../content/mySops.en'
import { AuthoredSopList } from '../components/mySops/AuthoredSopList'
import { AuthoredSopGrid } from '../components/mySops/AuthoredSopGrid'
import { MySopsPage } from './MySopsPage'

const fixture = vi.hoisted(() => ({
  user: { id: 'me', name: 'Main Author', initials: 'MA', email: 'me@example.test', departmentId: 'home', permissions: ['author'] } as User,
  sops: [] as Sop[],
}))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.user }))
vi.mock('../state/activeDepartmentContext', () => ({ useActiveDepartment: () => ({ homeDepartment: { id: 'home', name: 'Home department' }, activeDepartment: { id: 'foreign', name: 'Foreign directory' } }) }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: fixture.sops }) }))
vi.mock('../state/guidelinesContext', () => ({ useGuidelines: () => ({ current: { version: '4.0' } }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [{ id: 'home', name: 'Home department', requiresComplianceCheck: true }] }) }))

function sop(id: string, authorId: string, coAuthorIds: string[] = [], departmentId = 'home'): Sop {
  return { id, code: `SOP-HIDDEN-${id}`, title: `${id} procedure`, authorId, coAuthorIds, departmentId, status: 'draft', version: '2', lastUpdated: '2026-10-29', fileName: 'procedure.pdf', fileType: 'pdf', versions: [], reviewers: [], approvers: [], timeline: [], comments: [], complianceChecks: [] }
}
function renderPage() {
  return renderToStaticMarkup(<MemoryRouter><MySopsPage /></MemoryRouter>)
}
beforeEach(() => {
  fixture.user.permissions = ['author']
  fixture.sops = [sop('Owned', 'me'), sop('Coauthored', 'other', ['me']), sop('Foreign', 'me', [], 'foreign'), sop('Unowned', 'other')]
})
afterEach(() => vi.unstubAllGlobals())

describe('My SOPs presentation and permissions', () => {
  it('renders one view toggle, search, combined filter controls and the three categories', () => {
    const html = renderPage()
    expect(html.match(/aria-label="My SOPs view"/g)).toHaveLength(1)
    for (const text of ['Search SOPs', 'SOP Name', 'Last updated', 'My Role', 'New SOPs', 'In Progress', 'Completed']) expect(html).toContain(text)
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain('aria-labelledby="my-sops-tab-new"')
  })

  it('defaults to cards and honors its own remembered List view without using the directory preference', () => {
    const getItem = vi.fn((key: string) => key === 'hawkim.my-sops.view' ? 'list' : 'grid')
    vi.stubGlobal('localStorage', { getItem })
    const html = renderPage()
    expect(getItem).toHaveBeenCalledWith('hawkim.my-sops.view')
    expect(html).toMatch(/aria-pressed="true" aria-label="List view"/)
    expect(html).not.toContain('<article')
    vi.stubGlobal('localStorage', { getItem: () => 'unsupported' })
    expect(renderPage()).toContain('<article')
  })

  it('falls back to cards if browser storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
    expect(renderPage()).toContain('<article')
  })

  it.each([AuthoredSopList, AuthoredSopGrid])('shows both ownership badges, statuses, version and dates without serial numbers', (Component) => {
    const html = renderToStaticMarkup(<MemoryRouter><Component sops={fixture.sops.slice(0, 2)} content={mySopsEn} userId="me" /></MemoryRouter>)
    for (const text of ['Main Author', 'Co-Author', 'Owned procedure', 'Coauthored procedure', 'Draft', 'v2', 'Oct 29, 2026']) expect(html).toContain(text)
    expect(html).toContain('aria-label="Owned procedure (Main Author)"')
    expect(html).toContain('aria-label="Coauthored procedure (Co-Author)"')
    expect(html).not.toContain('SOP-HIDDEN')
  })

  it('continues to exclude foreign-department and unowned SOPs regardless of directory selection', () => {
    const html = renderPage()
    expect(html).toContain('Owned procedure')
    expect(html).toContain('Coauthored procedure')
    expect(html).not.toContain('Foreign procedure')
    expect(html).not.toContain('Unowned procedure')
    expect(html).not.toContain('SOP-HIDDEN')
    fixture.user.permissions = []
    expect(renderPage()).not.toContain('Owned procedure')
  })
})
