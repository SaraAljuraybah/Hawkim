import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ComplianceCard } from '../../components/workflow/ComplianceCard'
import { complianceEn } from '../../content/compliance.en'
import type { ComplianceCheck, GuidelineVersion, Sop } from '../../data/mock/types'
import { currentVersion, newestVersion } from '../../lib/guidelines'
import { AdminRegulationsPage } from './AdminRegulationsPage'
import { RegulationDetailsPage } from './RegulationDetailsPage'

// The database's current version is 4.0; an admin has added 4.1 since (newer, never current).
const v40: GuidelineVersion = { id: 'gvp-4-0', title: 'SFDA GVP', version: '4.0', effectiveDate: '2015-09-01', fileName: 'Drug-GVP4_0.pdf', addedAt: '2026-10-26T09:00:00Z', requirements: [] }
const v41: GuidelineVersion = { ...v40, id: 'uuid-41', version: '4.1', fileName: 'Drug-GVP4_1.pdf', addedAt: '2026-11-08T09:00:00Z', neverCurrent: true }
const fixture = vi.hoisted(() => ({ id: 'gvp-4-0' }))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/sessionContext', () => ({ useSession: () => ({ user: { id: 'admin' } }) }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: [], nameOf: () => '' }) }))
// What the guidelines store gives with these versions loaded (state/GuidelinesProvider.tsx).
vi.mock('../../state/guidelinesContext', () => ({
  useGuidelines: () => ({
    versions: [v40], current: currentVersion([v40]), currentGuideline: { name: 'GVP', version: currentVersion([v40]).version },
    allVersions: [v40, v41], addedStatus: 'ready', retryAdded: () => {}, deleteVersion: async () => {},
    getVersion: (id: string) => [v40, v41].find((item) => item.id === id),
  }),
}))

const sop = (complianceChecks: ComplianceCheck[], status: Sop['status'] = 'draft'): Sop => ({
  id: 'sop', code: 'SOP-001', title: 'Test', departmentId: 'home', version: '1', status, lastUpdated: '2026-11-01', authorId: 'author',
  coAuthorIds: [], fileName: 'a.pdf', fileType: 'pdf', versions: [], timeline: [], comments: [], complianceChecks, reviewers: [], approvers: [],
})
const check = (guideline: string): ComplianceCheck => ({
  id: 'chk', sopId: 'sop', version: '1', status: 'completed', startedAt: '2026-11-01T09:00:00Z', completedAt: '2026-11-01T09:00:03Z',
  guideline: { name: 'GVP', version: guideline }, findings: [],
})
const details = (id: string) => {
  fixture.id = id
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/admin/regulations/${id}`]}><Routes><Route path="/admin/regulations/:id" element={<RegulationDetailsPage />} /></Routes></MemoryRouter>,
  )
}

describe('"Current" on the SFDA Regulatory Requirements tab', () => {
  it('stays on the published current version (4.0) until an added version is made current (GVP phase 2)', () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminRegulationsPage /></MemoryRouter>)
    const card = html.slice(html.indexOf('id="current-title"'), html.indexOf('id="history-title"'))
    expect(card).toMatch(/GVP Version 4\.0<span class="[^"]*">Current<\/span>/)
    expect(card).not.toContain('Requirements')
    const table = html.slice(html.indexOf('<table', html.indexOf('id="history-title"')), html.indexOf('</table>', html.indexOf('id="history-title"')))
    expect(table).toMatch(/4\.0<span class="[^"]*">Current<\/span>/)
    expect(table.match(/>Current</g)).toHaveLength(1)
    expect(details('gvp-4-0')).toMatch(/>GVP Version 4\.0<\/h1><span[^>]*>Current<\/span>/)
    expect(details('uuid-41')).not.toContain('>Current<')
  })

  it('keeps Delete following the database: allowed on the added 4.1, refused on 4.0 as the current version', () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminRegulationsPage /></MemoryRouter>)
    const history = html.slice(html.indexOf('id="history-title"'))
    expect(history.match(/<button type="button" aria-label="Delete SFDA GVP v4\.1"[^>]*>/)![0]).not.toContain('aria-disabled="')
    expect(history).toMatch(/<button type="button" aria-disabled="true" aria-label="Delete SFDA GVP v4\.0"/)
    expect(history).toContain('The current version can&#x27;t be deleted.')
  })

  it('never picks an added version, and falls back when there is no published one', () => {
    expect(newestVersion([v40, v41], v40).version).toBe('4.0')
    expect(newestVersion([v40], v40).version).toBe('4.0')
    expect(newestVersion([], v40).version).toBe('4.0')
  })

  it('leaves compliance on the database\'s current version, 4.0', () => {
    // Checked against 4.0: no "Recheck recommended" (it would show if 4.1 counted as current).
    const checked = renderToStaticMarkup(<MemoryRouter><ComplianceCard sop={sop([check('4.0')])} content={complianceEn} /></MemoryRouter>)
    expect(checked).not.toContain(complianceEn.card.recheck.badge)
    // Checked against 3.0: the notice names 4.0 as the current version.
    const older = renderToStaticMarkup(<MemoryRouter><ComplianceCard sop={sop([check('3.0')])} content={complianceEn} /></MemoryRouter>)
    expect(older).toContain(complianceEn.card.recheck.note.replace('{checked}', '3.0').replace('{current}', '4.0'))
    expect(older).not.toContain('4.1')
  })
})
