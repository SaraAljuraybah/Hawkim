import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { GuidelineVersion } from '../../data/mock/types'
import { RegulationFormPage } from './RegulationFormPage'

// 4.0 is current and has no PDF yet; 3.0 was current before and has one; 5.0 was added and never current.
const v40: GuidelineVersion = {
  id: 'gvp-4-0', title: 'SFDA Guideline on Good Pharmacovigilance Practices (GVP)', version: '4.0', issuedDate: '2015-05-27',
  effectiveDate: '2015-09-01', fileName: 'Drug-GVP4_0.pdf', source: 'https://www.sfda.gov.sa/en/regulations/gvp',
  addedAt: '2026-10-26T09:00:00Z', requirements: [],
}
const v30: GuidelineVersion = { ...v40, id: 'gvp-3-0', version: '3.0', fileName: 'Drug-GVP3_0.pdf', storagePath: 'files/30.pdf', addedAt: '2026-10-20T09:00:00Z' }
const v50: GuidelineVersion = { ...v40, id: 'uuid-50', version: '5.0', fileName: 'Drug-GVP5_0.pdf', storagePath: 'files/50.pdf', addedAt: '2026-11-07T09:00:00Z', neverCurrent: true }
const all = [v30, v40, v50]
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/guidelinesContext', () => ({
  useGuidelines: () => ({ allVersions: all, current: v40, getVersion: (id: string) => all.find((item) => item.id === id), addVersion: vi.fn(), updateVersion: vi.fn() }),
}))

const render = (id = 'gvp-4-0') => renderToStaticMarkup(
  <MemoryRouter initialEntries={[`/admin/regulations/${id}/edit`]}>
    <Routes><Route path="/admin/regulations/:id/edit" element={<RegulationFormPage mode="edit" />} /></Routes>
  </MemoryRouter>,
)
const input = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))![0]
const ATTACH_HINT = 'Add the PDF for this version. Once added, it can&#x27;t be replaced.'

describe('Edit GVP version', () => {
  it('reuses the form, pre-filled, with Save and Cancel', () => {
    const html = render()
    expect(html).toContain('>Edit GVP Version</h1>')
    // No subtitle under the heading.
    expect(html).toMatch(/>Edit GVP Version<\/h1><form/)
    expect(input(html, 'title')).toContain('value="SFDA Guideline on Good Pharmacovigilance Practices (GVP)"')
    expect(input(html, 'issuedDate')).toContain('value="2015-05-27"')
    expect(input(html, 'source')).toContain('value="https://www.sfda.gov.sa/en/regulations/gvp"')
    expect(html).toMatch(/<button type="submit"[^>]*>Save<\/button>/)
    expect(html).toContain('>Cancel<')
  })

  it('keeps Version and Added to Hawkim On read-only for the current version; the title, issue date and source change', () => {
    const html = render()
    for (const name of ['version', 'addedDate']) expect(input(html, name)).toContain('readOnly=""')
    expect(input(html, 'version')).toContain('value="4.0"')
    expect(input(html, 'addedDate')).toContain('value="2026-10-26"')
    for (const name of ['title', 'issuedDate', 'source']) expect(input(html, name)).not.toContain('readOnly')
    expect(input(html, 'issuedDate')).toContain('required=""')
  })

  it('lets the current version with no PDF get one, optional, saying it can\'t be replaced', () => {
    const html = render()
    expect(html).toContain('Drag and drop')
    expect(html).toContain(ATTACH_HINT)
    expect(html).not.toContain('name="file"')
    const label = html.match(/<p id="[^"]+" class="[^"]*">File(.*?)<\/p>/)![1]
    expect(label).not.toContain('>*<')
    expect(label).not.toContain('(required)')
  })

  it('keeps the PDF of an earlier version that has one, read-only, with its number', () => {
    const html = render('gvp-3-0')
    expect(input(html, 'file')).toContain('readOnly=""')
    expect(input(html, 'file')).toContain('value="Drug-GVP3_0.pdf"')
    expect(input(html, 'version')).toContain('readOnly=""')
    expect(html).not.toContain('Drag and drop')
  })

  it('lets a version that was never current change its number, but not its PDF', () => {
    const html = render('uuid-50')
    expect(input(html, 'version')).not.toContain('readOnly')
    expect(input(html, 'version')).toContain('value="5.0"')
    expect(html).toContain('For example 4.1 or 5.0.')
    expect(input(html, 'addedDate')).toContain('readOnly=""')
    expect(input(html, 'addedDate')).toContain('value="2026-11-07"')
    expect(input(html, 'file')).toContain('readOnly=""')
    expect(input(html, 'file')).toContain('value="Drug-GVP5_0.pdf"')
    expect(html).not.toContain('Drag and drop')
    expect(html).not.toContain(ATTACH_HINT)
  })

  it('shows Not Found for an unknown version', () => {
    expect(render('gvp-9-9')).not.toContain('Edit GVP Version')
  })
})
