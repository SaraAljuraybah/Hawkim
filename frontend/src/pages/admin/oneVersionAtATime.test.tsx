import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { versionInProgress } from '../../lib/guidelines'
import { guidelineError } from '../../services/guidelines'
import { AdminRegulationsPage } from './AdminRegulationsPage'
import { RegulationFormPage } from './RegulationFormPage'

const v40: GuidelineVersion = { id: 'gvp-4-0', title: 'SFDA GVP', version: '4.0', effectiveDate: '2015-09-01', fileName: 'a.pdf', requirements: [] }
const added = (status: 'waiting' | 'processing' | 'failed'): GuidelineVersion =>
  ({ id: 'draft-41', title: 'SFDA GVP', version: '4.1', effectiveDate: '2026-11-11', fileName: 'b.pdf', requirements: [], neverCurrent: true, processing: { status } })
const fixture = { versions: [v40] as GuidelineVersion[] }
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: [], nameOf: () => '' }) }))
vi.mock('../../state/sessionContext', () => ({ useSession: () => ({ user: { id: 'nouf' } }) }))
vi.mock('../../state/guidelinesContext', () => ({
  useGuidelines: () => ({
    current: v40, currentGuideline: v40, allVersions: fixture.versions, addedStatus: 'ready', retryAdded: vi.fn(),
    getVersion: (id: string) => fixture.versions.find((item) => item.id === id), deleteVersion: vi.fn(), addVersion: vi.fn(), updateVersion: vi.fn(),
  }),
}))
const text = adminEn.regulations.inProgress
const list = () => renderToStaticMarkup(<MemoryRouter><AdminRegulationsPage /></MemoryRouter>)
const addForm = () => renderToStaticMarkup(<MemoryRouter><RegulationFormPage mode="add" /></MemoryRouter>)

describe('one GVP version at a time', () => {
  it('finds the version waiting for or being processed, but not a failed one', () => {
    expect(versionInProgress([v40, added('waiting')])?.id).toBe('draft-41')
    expect(versionInProgress([v40, added('processing')])?.id).toBe('draft-41')
    expect(versionInProgress([v40, added('failed')])).toBeUndefined()
    expect(versionInProgress([v40])).toBeUndefined()
  })

  it('links Add New Version to the form when nothing is processing', () => {
    fixture.versions = [v40, added('failed')]
    expect(list()).toMatch(/<a[^>]*href="\/admin\/regulations\/new"[^>]*>[\s\S]*?Add New Version<\/a>/)
    expect(addForm()).toContain('<form')
  })

  it('makes Add New Version explain the wait while a version is processing, and the form says so too', () => {
    fixture.versions = [v40, added('processing')]
    const html = list()
    expect(html).not.toMatch(/href="\/admin\/regulations\/new"/)
    expect(html).toMatch(/<button[^>]*>[\s\S]*?Add New Version<\/button>/)
    const form = addForm()
    expect(form).not.toContain('<form')
    expect(form).toContain(text.title)
    expect(form).toContain(text.text.replace('{version}', '4.1'))
    expect(form).toMatch(/href="\/admin\/regulations\/draft-41"[^>]*>View GVP 4\.1</)
  })

  it('reads the database refusal', () => {
    expect(guidelineError({ message: 'Another GVP version is still being processed', code: '55006', hint: 'version-processing' }).reason).toBe('version-processing')
  })
})
