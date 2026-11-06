import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { GuidelineVersion } from '../../data/mock/types'
import { RegulationFormPage } from './RegulationFormPage'

const v40: GuidelineVersion = {
  id: 'gvp-4-0', title: 'SFDA Guideline on Good Pharmacovigilance Practices (GVP)', version: '4.0', issuedDate: '2015-05-27',
  effectiveDate: '2015-09-01', fileName: 'Drug-GVP4_0.pdf', source: 'https://www.sfda.gov.sa/en/regulations/gvp',
  addedAt: '2026-10-26T09:00:00Z', requirements: [],
}
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/guidelinesContext', () => ({
  useGuidelines: () => ({ versions: [v40], current: v40, getVersion: (id: string) => (id === v40.id ? v40 : undefined), addVersion: vi.fn(), updateVersion: vi.fn() }),
}))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: [] }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => ({ id: 'admin' }) }))

const render = (id = 'gvp-4-0') => renderToStaticMarkup(
  <MemoryRouter initialEntries={[`/admin/regulations/${id}/edit`]}>
    <Routes><Route path="/admin/regulations/:id/edit" element={<RegulationFormPage mode="edit" />} /></Routes>
  </MemoryRouter>,
)
const input = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))![0]

describe('Edit GVP version', () => {
  it('reuses the form, pre-filled, with Save and Cancel', () => {
    const html = render()
    expect(html).toContain('>Edit GVP Version</h1>')
    // No subtitle under the heading.
    expect(html).toMatch(/>Edit GVP Version<\/h1><form/)
    expect(html).not.toContain('Change the title')
    expect(input(html, 'title')).toContain('value="SFDA Guideline on Good Pharmacovigilance Practices (GVP)"')
    expect(input(html, 'issuedDate')).toContain('value="2015-05-27"')
    expect(input(html, 'source')).toContain('value="https://www.sfda.gov.sa/en/regulations/gvp"')
    expect(html).toMatch(/<button type="submit"[^>]*>Save<\/button>/)
    expect(html).toContain('>Cancel<')
  })

  it('keeps Version and Added to Hawkim On read-only, and the file as it is', () => {
    const html = render()
    for (const name of ['version', 'addedDate', 'file']) expect(input(html, name)).toContain('readOnly=""')
    expect(input(html, 'version')).toContain('value="4.0"')
    expect(input(html, 'addedDate')).toContain('value="2026-10-26"')
    expect(input(html, 'file')).toContain('value="Drug-GVP4_0.pdf"')
    // No drop area: the file can't be changed.
    expect(html).not.toContain('Drag and drop')
    for (const name of ['title', 'issuedDate', 'source']) expect(input(html, name)).not.toContain('readOnly')
    // The issue date is required here too.
    expect(input(html, 'issuedDate')).toContain('required=""')
  })

  it('shows Not Found for an unknown version', () => {
    expect(render('gvp-9-9')).not.toContain('Edit GVP Version')
  })
})
