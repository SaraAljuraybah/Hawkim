import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { AdminRegulationsPage } from './AdminRegulationsPage'
import { RegulationDetailsPage } from './RegulationDetailsPage'

const requirement = { id: 'R1', module: 'Module I', section: 'I.B.10', sectionTitle: 'Record management', shortTitle: 'Access', page: 22, summary: '' }
const fixture = vi.hoisted(() => ({ titles: [] as string[] }))
const v30: GuidelineVersion = { id: 'gvp-3-0', version: '3.0', effectiveDate: '2012-01-01', fileName: 'Drug-GVP3_0.pdf', requirements: [requirement] }
const v40: GuidelineVersion = {
  id: 'gvp-4-0', title: 'SFDA Guideline on Good Pharmacovigilance Practices (GVP)', version: '4.0', issuedDate: '2015-05-27',
  effectiveDate: '2015-09-01', fileName: 'Drug-GVP4_0.pdf', addedAt: '2026-10-26T09:00:00Z', requirements: [requirement],
}
const v41: GuidelineVersion = {
  id: 'gvp-4-1', title: 'SFDA GVP Guideline', version: '4.1', effectiveDate: '2026-11-06', fileName: 'Drug-GVP4_1.pdf',
  source: 'https://www.sfda.gov.sa/en/regulations/gvp', addedById: 'nouf', addedAt: '2026-11-05T22:30:00Z', requirements: [requirement],
}
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: (title?: string) => { if (title) fixture.titles.push(title) } }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: [], nameOf: (id: string) => (id === 'nouf' ? 'Nouf Admin' : '') }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => ({ id: 'nouf' }) }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: [] }) }))
vi.mock('../../state/guidelinesContext', () => ({
  useGuidelines: () => ({ versions: [v30, v40, v41], current: v41, getVersion: (id: string) => [v30, v40, v41].find((item) => item.id === id), deleteVersion: vi.fn() }),
}))
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useParams: () => ({ id: 'gvp-4-1' }) }))

const render = () => renderToStaticMarkup(<MemoryRouter><AdminRegulationsPage /></MemoryRouter>)
const table = (html: string) => html.slice(html.indexOf('<table'), html.indexOf('</table>'))
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

  it('keeps the Current Version card with its fields but no File row or View Requirements link, and Source as a new-tab link', () => {
    const html = render()
    const card = html.slice(html.indexOf('id="current-title"'), html.indexOf('id="history-title"'))
    expect([...card.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])).toEqual(fields.filter((field) => field !== 'File'))
    expect(card).not.toContain('View Requirements')
    expect(card).not.toContain('Drug-GVP4_1.pdf')
    expect(card).toMatch(/Requirements<\/dt><dd[^>]*>1 Requirement<\/dd>/)
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

  it('lists every version newest first, the current one first with a Current badge, and — for empty values', () => {
    const html = table(render())
    const rows = [...html.matchAll(/<tr><th scope="row"[^>]*>([^<]+)<\/th>/g)].map((match) => match[1])
    expect(rows).toEqual(['SFDA GVP Guideline', 'SFDA Guideline on Good Pharmacovigilance Practices (GVP)', '—'])
    const first = html.slice(html.indexOf('<tr><th scope="row"'), html.indexOf('</tr>', html.indexOf('<tr><th scope="row"')))
    // "4.1 [Current]" on one line.
    expect(first).toMatch(/<span class="inline-flex items-center gap-2 whitespace-nowrap">4\.1<span class="[^"]*">Current<\/span><\/span>/)
    expect(first).not.toContain('flex-wrap')
    expect(html.match(/>Current</g)).toHaveLength(1)
    // 4.1 has no issue date; 3.0 has no title, issue date or added date.
    expect(html.match(/<td[^>]*>—<\/td>/g)).toHaveLength(3)
  })

  it('gives every version View, Edit and Delete buttons named "{title} v{version}", with tooltips', () => {
    const html = table(render())
    for (const name of ['SFDA GVP Guideline v4.1', 'SFDA Guideline on Good Pharmacovigilance Practices (GVP) v4.0']) {
      for (const label of [`View ${name}`, `Edit ${name}`, `Delete ${name}`]) {
        expect(html).toContain(`aria-label="${label}"`)
        expect(html).toMatch(new RegExp(`role="tooltip"[^>]*><span[^>]*>${label.replace(/[()]/g, '\\$&')}</span>`))
      }
    }
    // Delete is always clickable, in the danger icon style.
    expect(html).not.toContain('aria-disabled="true"')
    expect(html.match(/aria-label="Delete [^"]+"[^>]*>/g)!.every((button) => button.includes('text-status-rejected-fg'))).toBe(true)
  })

  it('shows the same rows and buttons as stacked cards below md', () => {
    const html = render()
    const cards = html.slice(html.indexOf('<ul aria-label="GVP versions, newest first"'))
    expect(cards).toContain('md:hidden')
    expect(cards).toContain('aria-label="Delete SFDA GVP Guideline v4.1"')
    expect(html).toContain('hidden md:block')
  })

  it('shows the same fields on a version\'s own page, the file in a card of its own', () => {
    const html = renderToStaticMarkup(<MemoryRouter><RegulationDetailsPage /></MemoryRouter>)
    expect([...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])).toEqual(fields.filter((field) => field !== 'File'))
  })
})

describe('the Delete GVP Version warning', () => {
  const text = adminEn.regulations.deleteDialog
  const dialog = (error?: string) => renderToStaticMarkup(
    <ConfirmDialog open title={text.title} description={text.description.replace('{name}', 'SFDA GVP Guideline v4.0')} cancelLabel={text.cancel}
      confirmLabel={text.confirm} error={error} canConfirm={() => false} onConfirm={() => {}} onCancel={() => {}} />,
  )

  it('asks with Cancel first and Delete in the primary style', () => {
    const html = dialog()
    expect(html).toContain('>Delete GVP Version?</h2>')
    expect(html).toContain('Are you sure you want to delete SFDA GVP Guideline v4.0? This can&#x27;t be undone.')
    expect(html.match(/<button[^>]*>Cancel<\/button>/)![0]).toContain('autofocus')
    expect(html.match(/<button[^>]*>Delete<\/button>/)![0]).toContain('bg-maroon')
    expect(html).toContain('<div role="alert"></div>')
  })

  it('shows why it was refused in the dialog', () => {
    expect(text.current).toBe("The current version can't be deleted.")
    expect(text.checked).toBe("This version can't be deleted because SOPs have been checked against it.")
    expect(dialog(text.current)).toContain('<div role="alert"><p class="mt-3 text-sm font-medium text-status-rejected-fg">The current version can&#x27;t be deleted.</p></div>')
  })
})
