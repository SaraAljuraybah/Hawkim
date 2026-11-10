import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { GuidelineVersion } from '../../data/mock/types'
import { RegulationDetailsPage } from './RegulationDetailsPage'

const v40: GuidelineVersion = { id: 'gvp-4-0', version: '4.0', effectiveDate: '2015-09-01', fileName: 'Drug-GVP4_0.pdf', requirements: [] }
const waiting: GuidelineVersion = { id: 'draft-42', version: '4.2', effectiveDate: '2026-11-09', fileName: 'GVP.pdf', requirements: [], neverCurrent: true, processing: { status: 'waiting' } }
// 4.3 finished processing: it is published now, with a new id, and remembers its draft.
const published: GuidelineVersion = { id: 'gvp-4-3', version: '4.3', effectiveDate: '2026-11-10', fileName: 'GVP43.pdf', requirements: [], fromDraftId: 'draft-43' }
const all = [v40, waiting, published]
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/sessionContext', () => ({ useSession: () => ({ user: { id: 'nouf' } }) }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ nameOf: () => '' }) }))
vi.mock('../../state/guidelinesContext', () => ({
  useGuidelines: () => ({ current: published, allVersions: all, getVersion: (id: string) => all.find((item) => item.id === id), retryProcessing: vi.fn(), makeCurrent: vi.fn() }),
}))
const render = (id: string) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[`/admin/regulations/${id}`]}><Routes>
    <Route path="/admin/regulations/:id" element={<RegulationDetailsPage />} />
  </Routes></MemoryRouter>,
)

describe('an added version\'s page', () => {
  it('uses the same status label as the list as the heading of the status card ("Status: Waiting" when read aloud)', () => {
    const html = render('draft-42')
    expect(html).toMatch(/<h2 id="guideline-processing-title"[^>]*><span class="sr-only">Status: <\/span><span class="[^"]*bg-status-pending-bg[^"]*">Waiting<\/span><\/h2>/)
    expect(html).toMatch(/>GVP Version 4\.2<\/h1><\/div>/)
    expect(html).not.toContain('>Processing</h2>')
  })

  it('moves to the published version once processing has made it current', () => {
    // Rendering the finished draft's address redirects (renders nothing here) instead of "not found".
    const html = render('draft-43')
    expect(html).not.toMatch(/not found/i)
    expect(html).toBe('')
  })
})
