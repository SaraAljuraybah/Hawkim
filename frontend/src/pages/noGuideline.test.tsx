import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { GuidelineVersion, Sop, User } from '../data/mock/types'
import { sops } from '../data/mock/sops'
import { GuidelineUnavailableDialog } from '../components/workflow/GuidelineUnavailableDialog'
import { requestGuidelineAdditionPath } from '../lib/routes'
import { AdminRegulationsPage } from './admin/AdminRegulationsPage'
import { SopGuidelinePage } from './SopGuidelinePage'
import { SopWorkflowPage } from './SopWorkflowPage'
import { SubmitRequestPage } from './SubmitRequestPage'

/*
 * A new organization has no regulatory guideline: the pages say so, never show a sample version or a Current
 * badge, and SOP work (upload, drafts) goes on. Check Compliance's dialog and the prefilled request form.
 */
const fixture = vi.hoisted(() => ({
  sop: null as Sop | null,
  versions: [] as GuidelineVersion[],
  allVersions: [] as GuidelineVersion[],
  users: [{ id: 'author', name: 'Main Writer', departmentId: 'home', permissions: ['author'] }] as User[],
}))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.users[0], useSession: () => ({ status: 'signed-in', user: fixture.users[0] }) }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ users: fixture.users, activeUsers: fixture.users, nameOf: () => 'Main Writer', getUser: () => fixture.users[0] }) }))
vi.mock('../state/departmentsContext', () => ({
  useDepartments: () => ({
    departments: [{ id: 'home', name: 'Pharmacovigilance', initials: 'PV', description: '', requiresComplianceCheck: true }],
    activeDepartments: [{ id: 'home', name: 'Pharmacovigilance' }, { id: 'qa', name: 'Quality Assurance' }],
    nameOf: () => 'Pharmacovigilance', getDepartment: () => undefined,
  }),
}))
vi.mock('../state/guidelinesContext', () => ({
  useGuidelines: () => ({
    status: 'ready', versions: fixture.versions, current: fixture.versions.at(-1), allVersions: fixture.allVersions,
    currentGuideline: undefined, addedStatus: 'ready', retryAdded: () => {}, refresh: async () => {}, deleteVersion: async () => 'deleted',
    getRequirement: () => undefined, getVersion: () => undefined,
  }),
}))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: [fixture.sop] }) }))
vi.mock('../state/requestsContext', () => ({ useMyRequests: () => [], useRequests: () => ({ addRequest: vi.fn() }) }))
vi.mock('../state/activeDepartmentContext', () => ({ useActiveDepartment: () => ({ activeDepartment: { id: 'home' }, homeDepartment: { id: 'home' } }) }))

const at = (path: string, route: string, page: ReactNode) =>
  renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={page} /></Routes></MemoryRouter>)
const workflow = () => at('/my-sops/test', '/my-sops/:id', <SopWorkflowPage />)
/** The Compliance Overview section of the workflow page. */
const overview = (html: string) => html.slice(html.indexOf('id="compliance-title"'), html.indexOf('</section>', html.indexOf('id="compliance-title"')))
/** Text as the static markup escapes it. */
const escaped = (text: string) => text.replace(/'/g, '&#x27;')

beforeEach(() => {
  fixture.versions = []
  fixture.allVersions = []
  fixture.sop = {
    ...sops[0], id: 'test', title: 'PV Signal Handling', departmentId: 'home', authorId: 'author', coAuthorIds: [], status: 'draft', version: '1',
    versions: [{ version: '1', fileName: 'a.pdf', fileType: 'pdf', uploadedAt: '2026-10-29T08:00:00Z', uploadedById: 'author' }],
    reviewers: [], approvers: [], internalReviewRounds: undefined, reviewFlow: undefined, comments: [], timeline: [], complianceChecks: [],
  }
})

describe('the SOP workflow page without a guideline', () => {
  it('says there is none: no sample version, no Current badge, no View button', () => {
    const html = overview(workflow())
    expect(html).toContain('Your organization has no regulatory guideline yet.')
    expect(html).not.toContain('SFDA GVP')
    expect(html).not.toContain('v4.0')
    expect(html).not.toMatch(/>Current</)
    expect(html).not.toContain('aria-label="View ')
  })

  it('keeps Check Compliance available (it explains on press) and keeps uploading available', () => {
    const html = workflow()
    const check = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Compliance Check for Current Version<\/button>/)
    expect(check).not.toBeNull()
    expect(check![0].match(/<button[^>]*>/)![0]).not.toMatch(/\saria-disabled="true"|\sdisabled=""/)
    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Add SOP<\/button>/)
  })

  it('the guideline page says there is none, without a version', () => {
    const html = at('/my-sops/test/guideline', '/my-sops/:id/guideline', <SopGuidelinePage />)
    expect(html).toContain('No Regulatory Guideline')
    expect(html).not.toMatch(/>Current</)
    expect(html).not.toContain('GVP Version')
  })
})

describe('SFDA Regulatory Requirements without a version', () => {
  const page = () => at('/admin/regulations', '/admin/regulations', <AdminRegulationsPage />)

  it('invites the Admin to add the first version; nothing is shown as current', () => {
    const html = page()
    expect(html).toContain('Your organization has no regulatory guideline yet.')
    expect(html).toContain('Add the First Version')
    expect(html).toContain('No versions have been added yet.')
    expect(html).not.toMatch(/>Current</)
    expect(html).not.toContain('GVP Version')
  })

  it('while the first version is processed: says so, still with no Current badge', () => {
    fixture.allVersions = [{
      id: 'draft', title: 'SFDA GVP', version: '1.0', effectiveDate: '2026-11-15', fileName: 'gvp.pdf', requirements: [], neverCurrent: true,
      addedAt: '2026-11-15T08:00:00Z', processing: { status: 'processing' },
    } as GuidelineVersion]
    const html = page()
    expect(html).toContain('GVP 1.0 is being processed.')
    expect(html).not.toContain('Add the First Version')
    expect(html).not.toMatch(/>Current</)
  })
})

describe('Check Compliance without a guideline: the dialog', () => {
  const dialog = (state: Parameters<typeof GuidelineUnavailableDialog>[0]['state']) =>
    renderToStaticMarkup(<MemoryRouter><GuidelineUnavailableDialog state={state} sopId="test" onClose={() => {}} /></MemoryRouter>)
  const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1])

  it('none: explains, and offers Submit a Request or Cancel', () => {
    const html = dialog('none')
    expect(html).toContain('No Regulatory Guidelines Available')
    expect(html).toContain('Please submit a request to your administrator to add the required guideline.')
    expect(buttons(html)).toEqual(['Cancel', 'Submit a Request'])
  })

  it('processing: a different message, only OK (no duplicate request suggested)', () => {
    const html = dialog('processing')
    expect(html).toContain('Regulatory Guideline Processing')
    expect(html).toContain('Compliance checking will be available once processing is completed.')
    expect(html).not.toContain('No Regulatory Guidelines Available')
    expect(buttons(html)).toEqual(['OK'])
  })

  it.each([['failed', 'failed'], ['unpublished', "isn't the current version yet"], ['cancelled', 'was cancelled']] as const)(
    '%s: says what really happened', (state, words) => {
      const html = dialog(state)
      expect(html).toContain(escaped(words))
      expect(html).not.toContain('No Regulatory Guidelines Available')
      expect(html).not.toContain('currently being processed')
    })

  it('a failed read: says it couldn\'t be checked, only OK', () => {
    const html = dialog('error')
    expect(html).toContain(escaped("Couldn't Check the Regulatory Guideline"))
    expect(buttons(html)).toEqual(['OK'])
  })

  it('no reason, no dialog', () => {
    expect(dialog(null)).not.toContain('Regulatory')
  })
})

describe('Submit a Request, opened from the dialog', () => {
  const form = (path: string) => at(path, '/requests/new', <SubmitRequestPage />)

  it('has Regulatory Guideline Addition chosen, a title and description filled in, and no Department or attachments', () => {
    const html = form(requestGuidelineAdditionPath('test'))
    expect(html).toMatch(/<option value="regulatory-guideline-addition"[^>]*selected=""[^>]*>Regulatory Guideline Addition<\/option>/)
    expect(html).toContain('value="Request to Add a Regulatory Guideline"')
    expect(html).toContain('no regulatory guideline available for compliance checking')
    expect(html).toContain('“PV Signal Handling”')
    expect(html).not.toContain('name="department"')
    expect(html).not.toContain('Attachments')
    // Nothing is sent yet: the form is shown with its Submit button, and Cancel leads back to the SOP.
    expect(html).toContain('Submit Request')
    expect(html).toContain('href="/my-sops/test"')
  })

  it('lists the new type among the existing ones, which keep their fields', () => {
    const html = form('/requests/new')
    for (const label of ['Department Access', 'Permission Change', 'Role Change', 'Regulatory Guideline Addition']) expect(html).toContain(`>${label}</option>`)
    expect(html).toContain('Attachments')
    expect(html).toContain('href="/requests"')
  })
})
