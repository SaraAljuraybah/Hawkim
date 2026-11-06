import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { AdminRegulationsPage } from './AdminRegulationsPage'
import { RegulationDetailsPage } from './RegulationDetailsPage'

const requirement = { id: 'R1', module: 'Module I', section: 'I.B.10', sectionTitle: 'Record management', shortTitle: 'Access', page: 22, summary: '' }
const fixture = vi.hoisted(() => ({ titles: [] as string[] }))
const v40: GuidelineVersion = {
  id: 'gvp-4-0', title: 'SFDA Guideline on Good Pharmacovigilance Practices (GVP)', version: '4.0', issuedDate: '2015-05-27',
  effectiveDate: '2015-09-01', fileName: 'Drug-GVP4_0.pdf', addedAt: '2026-10-26T09:00:00Z', requirements: [requirement],
}
const v41: GuidelineVersion = {
  id: 'gvp-4-1', title: 'SFDA GVP Guideline', version: '4.1', effectiveDate: '2026-11-06', fileName: 'Drug-GVP4_1.pdf',
  source: 'https://www.sfda.gov.sa/en/regulations/gvp', addedById: 'nouf', addedAt: '2026-11-05T22:30:00Z', requirements: [requirement],
}
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: (title?: string) => { if (title) fixture.titles.push(title) } }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ nameOf: (id: string) => (id === 'nouf' ? 'Nouf Admin' : '') }) }))
vi.mock('../../state/guidelinesContext', () => ({
  useGuidelines: () => ({ versions: [v40, v41], current: v41, getVersion: (id: string) => [v40, v41].find((item) => item.id === id) }),
}))

const render = () => renderToStaticMarkup(<MemoryRouter><AdminRegulationsPage /></MemoryRouter>)
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

  it('shows the current version\'s fields in order, with Source as a new-tab link', () => {
    const html = render()
    const card = html.slice(html.indexOf('id="current-title"'), html.indexOf('id="history-title"'))
    const labels = [...card.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])
    expect(labels).toEqual(fields)
    expect(card).toContain('>SFDA GVP Guideline<')
    // Added just after midnight in Riyadh: the Riyadh date.
    expect(card).toContain('<time dateTime="2026-11-06">Nov 6, 2026</time>')
    expect(card).toContain('>Nouf Admin<')
    expect(card).toMatch(/<a href="https:\/\/www\.sfda\.gov\.sa\/en\/regulations\/gvp" target="_blank" rel="noopener noreferrer"/)
    expect(card).toContain('<span class="sr-only"> (opens in a new tab)</span>')
    // No issue date: —
    expect(card).toMatch(/Issued by SFDA On<\/dt><dd[^>]*>—<\/dd>/)
    expect(card).not.toContain('Summary of Changes')
    expect(card).not.toContain('Effective')
  })

  it('lists earlier versions in a table with a Version column, and — for unknown values', () => {
    const html = render()
    const table = html.slice(html.indexOf('<table'), html.indexOf('</table>'))
    const columns = [...table.matchAll(/<th scope="col"[^>]*>(?:<span class="sr-only">)?([^<]+)/g)].map((match) => match[1])
    expect(columns).toEqual([...fields, 'Actions'])
    expect(table).toContain('<th scope="row" class="px-4 py-3 align-top font-medium text-maroon">SFDA Guideline on Good Pharmacovigilance Practices (GVP)</th>')
    expect(table).toContain('>4.0</td>')
    // No source or "added by" known for 4.0.
    expect(table.match(/<td[^>]*>—<\/td>/g)).toHaveLength(2)
    expect(table).toContain('aria-label="View requirements of GVP version 4.0"')
    expect(html).toContain('lg:hidden')
  })

  it('shows the same fields on a version\'s own page', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/regulations/gvp-4-1']}><RegulationDetailsWithId /></MemoryRouter>)
    const labels = [...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])
    expect(labels).toEqual(fields)
  })
})

vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useParams: () => ({ id: 'gvp-4-1' }) }))
function RegulationDetailsWithId() {
  return <RegulationDetailsPage />
}
