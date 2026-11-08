import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { AdminRegulationsPage } from './AdminRegulationsPage'
import { RegulationDetailsPage } from './RegulationDetailsPage'

const requirement = { id: 'R1', module: 'Module I', section: 'I.B.10', sectionTitle: 'Record management', shortTitle: 'Access', page: 22, summary: '' }
const fixture = vi.hoisted(() => ({ titles: [] as string[], addedStatus: 'ready' as 'ready' | 'loading' | 'error' }))
const v30: GuidelineVersion = { id: 'gvp-3-0', version: '3.0', effectiveDate: '2012-01-01', fileName: 'Drug-GVP3_0.pdf', requirements: [requirement] }
const v40: GuidelineVersion = {
  id: 'gvp-4-0', title: 'SFDA Guideline on Good Pharmacovigilance Practices (GVP)', version: '4.0', issuedDate: '2015-05-27',
  effectiveDate: '2015-09-01', fileName: 'Drug-GVP4_0.pdf', addedAt: '2026-10-26T09:00:00Z', requirements: [requirement],
}
const v41: GuidelineVersion = {
  id: 'gvp-4-1', title: 'SFDA GVP Guideline', version: '4.1', effectiveDate: '2026-11-06', fileName: 'Drug-GVP4_1.pdf',
  source: 'https://www.sfda.gov.sa/en/regulations/gvp', addedById: 'nouf', addedAt: '2026-11-05T22:30:00Z', requirements: [requirement],
}
// Added by an admin after 4.1, and never current.
const v50: GuidelineVersion = {
  id: 'uuid-50', title: 'SFDA GVP 5', version: '5.0', issuedDate: '2026-11-01', effectiveDate: '2026-11-07', fileName: 'Drug-GVP5_0.pdf',
  storagePath: 'files/50.pdf', addedAt: '2026-11-07T09:00:00Z', requirements: [], neverCurrent: true,
}
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: (title?: string) => { if (title) fixture.titles.push(title) } }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: [], nameOf: (id: string) => (id === 'nouf' ? 'Nouf Admin' : '') }) }))
vi.mock('../../state/sessionContext', () => ({ useSession: () => ({ user: { id: 'nouf' } }) }))
vi.mock('../../state/guidelinesContext', () => ({
  useGuidelines: () => ({
    versions: [v30, v40, v41], current: v41,
    // Without the added versions when they couldn't be loaded.
    allVersions: fixture.addedStatus === 'error' ? [v30, v40, v41] : [v30, v40, v41, v50], addedStatus: fixture.addedStatus, retryAdded: vi.fn(),
    getVersion: (id: string) => [v30, v40, v41, v50].find((item) => item.id === id), deleteVersion: vi.fn(),
  }),
}))
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useParams: () => ({ id: 'gvp-4-1' }) }))

const render = () => renderToStaticMarkup(<MemoryRouter><AdminRegulationsPage /></MemoryRouter>)
/** The Version History table (the Current Version card has a Requirements table too). */
const table = (html: string) => {
  const start = html.indexOf('<table', html.indexOf('id="history-title"'))
  return html.slice(start, html.indexOf('</table>', start))
}
const currentCard = (html: string) => html.slice(html.indexOf('id="current-title"'), html.indexOf('id="history-title"'))
const fields = ['Title', 'Version', 'Issued by SFDA On', 'Added to Hawkim On', 'Added By', 'Source', 'File', 'Requirements']

describe('SFDA Regulatory Requirements page', () => {
  it('is called SFDA Regulatory Requirements in the h1, the browser tab, the sidebar and the back links', () => {
    fixture.titles.length = 0
    const html = render()
    expect(html).toContain('>SFDA Regulatory Requirements</h1>')
    expect(fixture.titles.at(-1)).toBe(adminEn.pageTitle.replace('{page}', 'SFDA Regulatory Requirements'))
    expect(adminEn.shell.nav.find((item) => item.href === '/admin/regulations')?.label).toBe('SFDA Regulatory Requirements')
    expect(adminEn.regulationForm.back.label).toBe('Back to SFDA Regulatory Requirements')
    expect(adminEn.regulationDetails.back.label).toBe('Back to SFDA Regulatory Requirements')
  })

  it('keeps the Current Version card with its fields but no File or Requirements row and no View Requirements link, and Source as a new-tab link', () => {
    // Without the added versions, 4.1 is the newest.
    fixture.addedStatus = 'error'
    const html = render()
    fixture.addedStatus = 'ready'
    const card = currentCard(html)
    expect([...card.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])).toEqual(fields.filter((field) => field !== 'File' && field !== 'Requirements'))
    expect(card).not.toContain('View Requirements')
    expect(card).not.toContain('1 Requirement')
    expect(card).not.toContain('Drug-GVP4_1.pdf')
    // Added just after midnight in Riyadh: the Riyadh date.
    expect(card).toContain('<time dateTime="2026-11-06">Nov 6, 2026</time>')
    expect(card).toContain('>Nouf Admin<')
    expect(card).toMatch(/<a href="https:\/\/www\.sfda\.gov\.sa\/en\/regulations\/gvp" target="_blank" rel="noopener noreferrer"/)
    expect(card).toContain('<span class="sr-only"> (opens in a new tab)</span>')
  })

  it('lists only Title, Version, Issued by SFDA On and Added to Hawkim On, with a hidden Actions header that does not wrap', () => {
    const html = table(render())
    const columns = [...html.matchAll(/<th scope="col"[^>]*>(?:<span class="sr-only">)?([^<]+)/g)].map((match) => match[1])
    expect(columns).toEqual(['Title', 'Version', 'Issued by SFDA On', 'Added to Hawkim On', 'Actions'])
    expect(html).toContain('<span class="sr-only">Actions</span>')
    for (const header of ['Version', 'Issued by SFDA On', 'Added to Hawkim On']) {
      expect(html).toMatch(new RegExp(`<th scope="col" class="[^"]*whitespace-nowrap[^"]*">${header}</th>`))
    }
    expect(html).toContain('<thead class="text-offwhite [&amp;_th]:bg-maroon">')
    for (const removed of ['Added By', 'Source', 'File', 'Requirements', 'View Requirements']) expect(html).not.toContain(`>${removed}<`)
  })

  it('lists every version together, newest first by when it was added, with the Current badge only on the newest one', () => {
    const html = table(render())
    const rows = [...html.matchAll(/<tr><th scope="row"[^>]*>([^<]+)<\/th>/g)].map((match) => match[1])
    expect(rows).toEqual(['SFDA GVP 5', 'SFDA GVP Guideline', 'SFDA Guideline on Good Pharmacovigilance Practices (GVP)', '—'])
    const rowOf = (version: string) => html.split('<tr>').find((row) => row.includes(`whitespace-nowrap">${version}`))!
    // "5.0 [Current]" on one line: the newest, though an admin added it (display only); 4.1 is current in the database.
    expect(rowOf('5.0')).toMatch(/<span class="inline-flex items-center gap-2 whitespace-nowrap">5\.0<span class="[^"]*">Current<\/span><\/span>/)
    expect(rowOf('5.0')).not.toContain('flex-wrap')
    expect(rowOf('4.1')).not.toContain('>Current<')
    expect(html.match(/>Current</g)).toHaveLength(1)
    // 4.1 has no issue date; 3.0 has no title, issue date or added date.
    expect(html.match(/<td[^>]*>—<\/td>/g)).toHaveLength(3)
  })

  it('shows the newest version in the Current Version card, without a Requirements row', () => {
    const card = currentCard(render())
    expect(card).toMatch(/GVP Version 5\.0<span class="[^"]*">Current<\/span>/)
    expect(card).not.toContain('4.1')
    expect(card).not.toContain('Requirements')
    expect(card).not.toContain('<table')
  })

  it('gives every version View, Edit and Delete named "{title} v{version}", with tooltips', () => {
    const html = table(render())
    const names = ['SFDA GVP 5 v5.0', 'SFDA GVP Guideline v4.1', 'SFDA Guideline on Good Pharmacovigilance Practices (GVP) v4.0', ' v3.0']
    for (const name of names) {
      for (const label of [`View ${name}`, `Edit ${name}`]) {
        expect(html).toContain(`aria-label="${label}"`)
        expect(html).toMatch(new RegExp(`role="tooltip"[^>]*><span[^>]*>${label.replace(/[()]/g, '\\$&')}</span>`))
      }
    }
    expect(html.match(/aria-label="Delete [^"]+"/g)).toEqual(names.map((name) => `aria-label="Delete ${name}"`))
  })

  it('lets only a version that was never current be deleted, in the danger style', () => {
    const html = table(render())
    const button = html.match(/<button type="button" aria-label="Delete SFDA GVP 5 v5\.0"[^>]*>/)![0]
    expect(button).not.toContain('aria-disabled="')
    expect(button).not.toContain('aria-describedby')
    expect(button).toContain('text-status-rejected-fg')
    expect(html).toMatch(/role="tooltip"[^>]*><span[^>]*>Delete SFDA GVP 5 v5\.0<\/span>/)
  })

  it('disables Delete on the database\'s current version and on earlier ones (as before), saying why in the tooltip, read after the name', () => {
    const html = table(render())
    const disabled = (name: string, reason: string) => {
      const escaped = name.replace(/[().]/g, '\\$&')
      const button = html.match(new RegExp(`<button type="button" aria-disabled="true" aria-label="Delete ${escaped}" aria-describedby="([^"]+)"[^>]*>`))
      expect(button, name).not.toBeNull()
      // The existing disabled look: greyed, not-allowed cursor, still focusable (no disabled attribute).
      expect(button![0]).toContain('aria-disabled:text-text-gray/70')
      expect(button![0]).toContain('aria-disabled:cursor-not-allowed')
      expect(button![0]).not.toMatch(/ disabled=""/)
      // The tooltip it points to says why; it opens on hover and on keyboard focus.
      const id = button![1].replace(/[:]/g, '\\:')
      expect(html).toMatch(new RegExp(`<span id="${id}" role="tooltip" hidden=""[^>]*><span[^>]*>${reason.replace(/'/g, '&#x27;')}</span>`))
    }
    disabled('SFDA GVP Guideline v4.1', "The current version can't be deleted.")
    disabled('SFDA Guideline on Good Pharmacovigilance Practices (GVP) v4.0', "Versions that were used for compliance checks can't be deleted.")
    disabled(' v3.0', "Versions that were used for compliance checks can't be deleted.")
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(3)
  })

  it('keeps the reasons in the content file', () => {
    expect(adminEn.regulations.deleteBlocked).toEqual({
      current: "The current version can't be deleted.",
      used: "Versions that were used for compliance checks can't be deleted.",
    })
  })

  it('shows the same rows and buttons as stacked cards below md', () => {
    const html = render()
    const cards = html.slice(html.indexOf('<ul aria-label="GVP versions, newest first"'))
    expect(cards).toContain('md:hidden')
    expect(cards).toContain('aria-label="Delete SFDA GVP 5 v5.0"')
    expect(cards).toMatch(/aria-disabled="true" aria-label="Delete SFDA GVP Guideline v4\.1"/)
    expect(cards).toContain('aria-label="Edit SFDA GVP Guideline v4.1"')
    expect(html).toContain('hidden md:block')
  })

  it('shows the same fields on a version\'s own page, the file in a card of its own', () => {
    const html = renderToStaticMarkup(<MemoryRouter><RegulationDetailsPage /></MemoryRouter>)
    // The requirements count (a disclosure) stays here.
    expect([...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])).toEqual(fields.filter((field) => field !== 'File'))
  })
})

describe('when the versions admins added couldn\'t be loaded', () => {
  it('says so in the Version History with Retry, and still shows the published versions and the current one', () => {
    fixture.addedStatus = 'error'
    const html = render()
    fixture.addedStatus = 'ready'
    const history = html.slice(html.indexOf('id="history-title"'))
    expect(history).toMatch(/<div role="alert"[^>]*>.*Some versions couldn&#x27;t be loaded\. Check your connection and try again\.<\/p><button[^>]*>Retry<\/button><\/div>/)
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('<table', html.indexOf('id="history-title"')))
    expect(table(html)).toContain('SFDA GVP Guideline')
    expect(table(html)).not.toContain('SFDA GVP 5')
    expect(html.slice(html.indexOf('id="current-title"'), html.indexOf('id="history-title"'))).toContain('GVP Version 4.1')
    expect(html).toContain('>Add New Version<')
  })

  it('shows no message otherwise', () => {
    expect(render()).not.toContain('couldn&#x27;t be loaded')
  })
})

describe('the Delete GVP Version warning', () => {
  const text = adminEn.regulations.deleteDialog
  const dialog = (error?: string) => renderToStaticMarkup(
    <ConfirmDialog open title={text.title} description={text.description.replace('{name}', 'SFDA GVP Guideline v4.0')} cancelLabel={text.cancel}
      confirmLabel={text.confirm} error={error} onConfirm={() => {}} onCancel={() => {}} />,
  )

  it('asks with Cancel first and Delete in the primary style', () => {
    const html = dialog()
    expect(html).toContain('>Delete GVP Version?</h2>')
    expect(html).toContain('Are you sure you want to delete SFDA GVP Guideline v4.0? This can&#x27;t be undone.')
    expect(html.match(/<button[^>]*>Cancel<\/button>/)![0]).toContain('autofocus')
    expect(html.match(/<button[^>]*>Delete<\/button>/)![0]).toContain('bg-maroon')
    expect(html).toContain('<div role="alert"></div>')
  })

  it('shows why deleting didn\'t work in the dialog, and has no refusal texts any more', () => {
    expect(text.permission).toBe("You don't have permission to do this. Sign in again and retry.")
    expect(text.failed).toBe('Check your connection and try again.')
    expect(text).not.toHaveProperty('current')
    expect(text).not.toHaveProperty('checked')
    expect(dialog(text.failed)).toContain('<div role="alert"><p class="mt-3 text-sm font-medium text-status-rejected-fg">Check your connection and try again.</p></div>')
  })
})
