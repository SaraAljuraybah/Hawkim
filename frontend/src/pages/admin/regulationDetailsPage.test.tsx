import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { GuidelineVersionDetails } from '../../components/admin/GuidelineVersionDetails'
import { tableStyles } from '../../components/ui/tableStyles'
import type { GuidelineVersion } from '../../data/mock/types'
import { RegulationDetailsPage } from './RegulationDetailsPage'

const requirement = { id: 'R1', module: 'Module I', section: 'I.B.10', sectionTitle: 'Record management', shortTitle: 'Access', page: 22, summary: 'Keep records.' }
// 4.0: only its file name, no PDF yet. 4.1: a sample PDF. 5.0: a PDF in storage.
const v40: GuidelineVersion = { id: 'gvp-4-0', title: 'SFDA GVP', version: '4.0', effectiveDate: '2015-09-01', fileName: 'Drug-GVP4_0.pdf', requirements: [requirement, { ...requirement, id: 'R2' }] }
const v41: GuidelineVersion = { ...v40, id: 'gvp-4-1', version: '4.1', fileName: 'Drug-GVP4_1.pdf', fileUrl: 'blob:http://localhost/abc' }
const v50: GuidelineVersion = { ...v40, id: 'uuid-50', version: '5.0', fileName: 'Drug-GVP5_0.pdf', storagePath: 'files/50.pdf', requirements: [], neverCurrent: true }
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/sessionContext', () => ({ useSession: () => ({ user: { id: 'nouf' } }) }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ nameOf: () => '' }) }))
vi.mock('../../state/guidelinesContext', () => ({
  // 4.1 is current in the database; 5.0, added later, is the newest.
  useGuidelines: () => ({ current: v41, allVersions: [v40, v41, v50], getVersion: (id: string) => [v40, v41, v50].find((item) => item.id === id) }),
}))

const render = (id: string) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[`/admin/regulations/${id}`]}><Routes><Route path="/admin/regulations/:id" element={<RegulationDetailsPage />} /></Routes></MemoryRouter>,
)
const detail = (html: string, label: string) => html.match(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>(.*?)</dd>`))![1]

describe('a GVP version\'s requirements', () => {
  it('opens from the requirements count: a link-style button with aria-expanded, aria-controls and a down chevron', () => {
    const html = render('gvp-4-0')
    const button = detail(html, 'Requirements')
    expect(button).toMatch(/^<button type="button" aria-expanded="false" aria-controls="guideline-requirements" class="[^"]*text-maroon[^"]*hover:underline/)
    expect(button).toContain('>2 Requirements<')
    expect(button).toContain('lucide-chevron-down')
    expect(button).not.toContain('lucide-chevron-up')
  })

  it('hides the Requirements section, heading included, until it is opened', () => {
    const html = render('gvp-4-0')
    expect(html).toMatch(/<section id="guideline-requirements" aria-labelledby="requirements-title" hidden=""/)
    const section = html.slice(html.indexOf('id="guideline-requirements"'))
    expect(section).toContain('id="requirements-title"')
    expect(section).toContain('Keep records.')
  })

  it('shows an up chevron while open', () => {
    const open = renderToStaticMarkup(
      <GuidelineVersionDetails version={v40} actions={{ requirements: { expanded: true, controlsId: 'x', onToggle: () => {} } }} />,
    )
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('lucide-chevron-up')
  })

  it('stays plain text where there is no table (the Current Version card)', () => {
    const html = renderToStaticMarkup(<GuidelineVersionDetails version={v40} />)
    expect(detail(html, 'Requirements')).toBe('2 Requirements')
    expect(detail(html, 'File')).toBe('<span class="break-all">Drug-GVP4_0.pdf</span>')
  })
})

describe('the Requirements table', () => {
  it('has the same style as the admin Users and Version History tables, with its columns and content', () => {
    const html = render('gvp-4-0')
    const table = html.slice(html.indexOf('<table'), html.indexOf('</table>'))
    expect(table).toContain(`<table aria-label="Requirements" class="${tableStyles.table}">`)
    expect(table).toContain(`<thead class="${tableStyles.head.replace('&', '&amp;')}">`)
    const headers = [...table.matchAll(/<th scope="col" class="([^"]*)">([^<]+)<\/th>/g)]
    expect(headers.map((match) => match[2])).toEqual(['ID', 'Module', 'Section', 'Title', 'Page', 'Summary'])
    for (const [, classes] of headers) expect(classes).toBe(tableStyles.headCell)
    expect(table).toContain(`<th scope="row" class="${tableStyles.rowHeader}">R1</th>`)
    expect(table).toContain('Keep records.')
    // The same frame, and stacked cards below md like the other tables.
    expect(html).toContain(`<div class="mt-3 ${tableStyles.frame}"><div class="${tableStyles.wide} overflow-x-auto">`)
    expect(html).toContain(`<ul aria-label="Requirements" class="${tableStyles.cards}">`)
    expect(html).not.toContain('bg-beige/60')
  })
})

describe('a GVP version\'s File card', () => {
  const card = (html: string) => html.slice(html.indexOf('<section aria-labelledby="file-title"'), html.indexOf('</section>', html.indexOf('<section aria-labelledby="file-title"')))

  it('replaces the File row in the Details card, and comes after the Requirements section', () => {
    const html = render('gvp-4-1')
    expect([...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])).not.toContain('File')
    expect(card(html)).toContain('<h2 id="file-title" class="text-lg">File</h2>')
    expect(html.indexOf('id="details-title"')).toBeLessThan(html.indexOf('id="guideline-requirements"'))
    expect(html.indexOf('id="guideline-requirements"')).toBeLessThan(html.indexOf('id="file-title"'))
  })

  it('shows the file name and the embedded PDF (with its own download) when this browser has the file', () => {
    const file = card(render('gvp-4-1'))
    expect(file).toContain('>Drug-GVP4_1.pdf</p>')
    // No separate Download button.
    expect(file).not.toContain('download=')
    expect(file).not.toContain('role="tooltip"')
    const viewer = file.match(/<iframe[^>]*>/)![0]
    expect(viewer).toContain('src="blob:http://localhost/abc"')
    expect(viewer).toContain('title="Drug-GVP4_1.pdf (PDF)"')
    expect(viewer).toContain('w-full')
    expect(viewer).toContain('h-[80vh]')
    expect(file).not.toContain('isn&#x27;t available')
  })

  it('says it isn\'t available yet otherwise, with no Download and no viewer', () => {
    const file = card(render('gvp-4-0'))
    expect(file).toContain('>Drug-GVP4_0.pdf</p>')
    expect(file).toContain('The file isn&#x27;t available yet.')
    expect(file).not.toContain('download=')
    expect(file).not.toContain('<iframe')
  })

  it('makes a signed link for a stored PDF, saying nothing while it is being made', () => {
    const file = card(render('uuid-50'))
    expect(file).toContain('>Drug-GVP5_0.pdf</p>')
    expect(file).not.toContain('isn&#x27;t available')
    expect(file).not.toContain('couldn&#x27;t be opened')
    expect(file).not.toContain('<iframe')
  })

  it('shows no Current badge on an added version (it is current only after Make Current), with no requirements yet', () => {
    const html = render('uuid-50')
    expect(html).toMatch(/>GVP Version 5\.0<\/h1>/)
    expect(html).not.toContain('>Current<')
    expect(detail(html, 'Requirements')).toContain('>0 Requirements<')
  })

  it('shows the Current badge on the database\'s current version only', () => {
    expect(render('gvp-4-1')).toMatch(/>GVP Version 4\.1<\/h1><span class="[^"]*">Current<\/span>/)
    expect(render('gvp-4-0')).not.toContain('>Current<')
  })

  it('has no preview dialog any more', () => {
    expect(render('gvp-4-1')).not.toContain('<dialog')
  })
})
