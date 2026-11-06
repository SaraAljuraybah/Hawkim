import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { GuidelineVersionDetails } from '../../components/admin/GuidelineVersionDetails'
import type { GuidelineVersion } from '../../data/mock/types'
import { RegulationDetailsPage } from './RegulationDetailsPage'

const requirement = { id: 'R1', module: 'Module I', section: 'I.B.10', sectionTitle: 'Record management', shortTitle: 'Access', page: 22, summary: 'Keep records.' }
// 4.0 as loaded from the database: only its file name. 4.1 added in this browser: its PDF too.
const v40: GuidelineVersion = { id: 'gvp-4-0', title: 'SFDA GVP', version: '4.0', effectiveDate: '2015-09-01', fileName: 'Drug-GVP4_0.pdf', requirements: [requirement, { ...requirement, id: 'R2' }] }
const v41: GuidelineVersion = { ...v40, id: 'gvp-4-1', version: '4.1', fileName: 'Drug-GVP4_1.pdf', fileUrl: 'blob:http://localhost/abc' }
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ nameOf: () => '' }) }))
vi.mock('../../state/guidelinesContext', () => ({
  useGuidelines: () => ({ current: v41, getVersion: (id: string) => [v40, v41].find((item) => item.id === id) }),
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
    expect(button).toContain('>2 requirements<')
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
    expect(detail(html, 'Requirements')).toBe('2 requirements')
    expect(detail(html, 'File')).toBe('<span class="break-all">Drug-GVP4_0.pdf</span>')
  })
})

describe('a GVP version\'s file', () => {
  it('can be previewed and downloaded when this browser has it', () => {
    const file = detail(render('gvp-4-1'), 'File')
    expect(file).toMatch(/<button type="button" aria-label="Preview Drug-GVP4_1.pdf"[^>]*><span class="break-all">Drug-GVP4_1.pdf<\/span><\/button>/)
    expect(file).toMatch(/<a href="blob:http:\/\/localhost\/abc" download="Drug-GVP4_1.pdf" aria-label="Download Drug-GVP4_1.pdf"/)
    expect(file).not.toContain('isn&#x27;t available')
  })

  it('says it isn\'t available yet otherwise, with no preview or download', () => {
    const file = detail(render('gvp-4-0'), 'File')
    expect(file).toContain('Drug-GVP4_0.pdf')
    expect(file).toContain('The file isn&#x27;t available yet.')
    expect(file).not.toContain('<button')
    expect(file).not.toContain('download=')
  })
})
