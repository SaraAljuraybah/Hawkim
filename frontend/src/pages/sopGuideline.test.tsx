import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { tableStyles } from '../components/ui/tableStyles'
import { complianceEn } from '../content/compliance.en'
import type { GuidelineVersion, Sop, User } from '../data/mock/types'
import { sops } from '../data/mock/sops'
import { sopGuidelinePath } from '../lib/routes'
import { ReviewPage } from './ReviewPage'
import { SopGuidelinePage } from './SopGuidelinePage'
import { SopWorkflowPage } from './SopWorkflowPage'

const requirement = { id: 'R1', module: 'Module I', section: 'I.B.10', sectionTitle: 'Record management', shortTitle: '', page: 22, summary: 'Keep records.' }
// The database's current version is 4.0; an admin has since added 4.1 (never current).
const v40: GuidelineVersion = {
  id: 'gvp-4-0', title: 'SFDA GVP', version: '4.0', issuedDate: '2015-05-27', effectiveDate: '2015-09-01', fileName: 'Drug-GVP4_0.pdf',
  addedAt: '2026-10-26T09:00:00Z', source: 'https://www.sfda.gov.sa/en/regulations/gvp', requirements: [requirement, { ...requirement, id: 'R2' }],
}
const v41: GuidelineVersion = { ...v40, id: 'uuid-41', version: '4.1', fileName: 'Drug-GVP4_1.pdf', addedAt: '2026-11-08T09:00:00Z', requirements: [], neverCurrent: true }

const fixture = vi.hoisted(() => ({ sop: null as Sop | null, userId: 'author', checks: true, users: [
  { id: 'author', name: 'Main Writer', departmentId: 'home', permissions: ['author'] },
  { id: 'coauthor', name: 'Co Writer', departmentId: 'home', permissions: ['author'] },
  { id: 'other', name: 'Other Writer', departmentId: 'home', permissions: ['author'] },
  { id: 'reviewer', name: 'Current Reviewer', departmentId: 'home', permissions: ['reviewer'] },
] as User[] }))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.users.find((user) => user.id === fixture.userId), useSession: () => ({ status: 'signed-in', user: fixture.users.find((user) => user.id === fixture.userId) }) }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ users: fixture.users, activeUsers: fixture.users, nameOf: (id: string) => fixture.users.find((user) => user.id === id)?.name ?? '', getUser: (id: string) => fixture.users.find((user) => user.id === id) }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '', requiresComplianceCheck: fixture.checks }], nameOf: () => 'Home' }) }))
vi.mock('../state/guidelinesContext', () => ({
  useGuidelines: () => ({ versions: [v40], current: v40, currentGuideline: { name: 'GVP', version: '4.0' }, allVersions: [v40, v41], getRequirement: () => undefined, getVersion: () => undefined }),
}))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: [fixture.sop] }) }))
vi.mock('../state/requestsContext', () => ({ useMyRequests: () => [] }))
vi.mock('../state/activeDepartmentContext', () => ({ useActiveDepartment: () => ({ activeDepartment: { id: 'home' }, homeDepartment: { id: 'home' } }) }))

const at = (path: string, route: string, page: ReactNode) =>
  renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={page} /></Routes></MemoryRouter>)
const workflow = () => at('/my-sops/test', '/my-sops/:id', <SopWorkflowPage />)
const guidelinePage = () => at('/my-sops/test/guideline', '/my-sops/:id/guideline', <SopGuidelinePage />)
const overview = (html: string) => html.slice(html.indexOf('id="compliance-title"'), html.indexOf('</section>', html.indexOf('id="compliance-title"')))

beforeEach(() => {
  fixture.userId = 'author'
  fixture.checks = true
  fixture.sop = {
    ...sops[0], id: 'test', title: 'Visible Procedure', departmentId: 'home', authorId: 'author', coAuthorIds: ['coauthor'], status: 'draft', version: '1',
    versions: [{ version: '1', fileName: 'a.pdf', fileType: 'pdf', uploadedAt: '2026-10-29T08:00:00Z', uploadedById: 'author' }],
    reviewers: [], approvers: [], internalReviewRounds: undefined, reviewFlow: undefined, comments: [], timeline: [], complianceChecks: [],
  }
})

describe('the GVP version on the author\'s Compliance Overview', () => {
  it('comes before the card\'s text: one row, the version compliance checks use, with the Current badge', () => {
    const html = overview(workflow())
    expect(html.indexOf(`<table aria-label="${complianceEn.card.guideline.tableLabel}"`)).toBeGreaterThan(-1)
    expect(html.indexOf('<table')).toBeLessThan(html.indexOf('v1 hasn’t been checked yet.'))
    const table = html.slice(html.indexOf('<table'), html.indexOf('</table>'))
    expect([...table.matchAll(/<th scope="col"[^>]*>(?:<span class="sr-only">)?([^<]+)/g)].map((match) => match[1])).toEqual(['Title', 'Version', 'Issued by SFDA On', 'Added to Hawkim On', 'Actions'])
    expect(table.match(/<tr>/g)).toHaveLength(2)
    expect(table).toContain(`<th scope="row" class="${tableStyles.rowHeader}">SFDA GVP</th>`)
    expect(table).toMatch(/<span class="inline-flex items-center gap-2 whitespace-nowrap">4\.0<span class="[^"]*">Current<\/span><\/span>/)
    expect(table).toContain('<time dateTime="2015-05-27">')
    expect(table).toContain('<time dateTime="2026-10-26">')
  })

  it('never shows a version an admin added since', () => {
    expect(overview(workflow())).not.toContain('4.1')
  })

  it('has the same style as the admin\'s Version History, and only a View button', () => {
    const html = overview(workflow())
    expect(html).toContain(`<div class="mb-5 ${tableStyles.frame}"><div class="${tableStyles.wide}">`)
    expect(html).toContain(`<thead class="${tableStyles.head.replace('&', '&amp;')}">`)
    expect(html).toContain(`<ul aria-label="${complianceEn.card.guideline.tableLabel}" class="${tableStyles.cards}">`)
    expect(html.match(/aria-label="View SFDA GVP v4\.0"/g)).toHaveLength(2)
    expect(html).not.toMatch(/aria-label="(Edit|Delete) /)
  })

  it('isn\'t there when the SOP\'s department needs no compliance checks (no Compliance Overview)', () => {
    fixture.checks = false
    expect(workflow()).not.toContain(complianceEn.card.guideline.tableLabel)
  })

  it('isn\'t on the review page', () => {
    fixture.sop = { ...fixture.sop!, status: 'in-review', reviewers: [{ userId: 'reviewer', decision: 'pending' }],
      timeline: [{ id: 'sent', type: 'submitted', actorId: 'author', recipientIds: ['reviewer'], createdAt: '2026-10-29T08:00:00Z', version: '1' }] }
    fixture.userId = 'reviewer'
    const html = at('/reviews/test', '/reviews/:id', <ReviewPage />)
    expect(html).toContain('Visible Procedure')
    expect(html).not.toContain(complianceEn.card.guideline.tableLabel)
    expect(html).not.toContain('View SFDA GVP')
  })
})

describe('the author\'s GVP page', () => {
  it('is at /my-sops/<id>/guideline', () => {
    expect(sopGuidelinePath('test')).toBe('/my-sops/test/guideline')
    expect(sopGuidelinePath('a b')).toBe('/my-sops/a%20b/guideline')
  })

  it('shows the version compliance checks use, read-only: back to the SOP, h1 with Current, details, requirements and the file', () => {
    const html = guidelinePage()
    expect(html).toMatch(/<a [^>]*href="\/my-sops\/test"[^>]*>.*Back to Visible Procedure<\/a>/)
    expect(html).toMatch(/<h1[^>]*>GVP Version 4\.0<\/h1><span class="[^"]*">Current<\/span>/)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect([...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])).toEqual(['Title', 'Version', 'Issued by SFDA On', 'Added to Hawkim On', 'Added By', 'Source', 'Requirements'])
    expect(html).toMatch(/<button type="button" aria-expanded="false" aria-controls="guideline-requirements"[^>]*>2 Requirements/)
    expect(html).toMatch(/<section id="guideline-requirements" aria-labelledby="requirements-title" hidden=""/)
    expect(html).toContain('Keep records.')
    expect(html).toContain('<h2 id="file-title" class="text-lg">File</h2>')
    expect(html).toContain('>Drug-GVP4_0.pdf</p>')
    expect(html).not.toMatch(/Edit|Delete/)
    expect(html).not.toContain('4.1')
  })

  it('opens for a co-author too', () => {
    fixture.userId = 'coauthor'
    expect(guidelinePage()).toContain('>GVP Version 4.0</h1>')
  })

  it('is Not Found for a reviewer and for an author who isn\'t on the SOP', () => {
    for (const userId of ['reviewer', 'other']) {
      fixture.userId = userId
      const html = guidelinePage()
      expect(html, userId).toContain('Page Not Found')
      expect(html, userId).not.toContain('GVP Version')
    }
  })
})
