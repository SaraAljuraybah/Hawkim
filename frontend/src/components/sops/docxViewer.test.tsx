import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { Department, Sop, User } from '../../data/mock/types'
import { isSafeDocxHref, sanitizeDocxLinks } from '../../lib/docxLinks'
import { SopDetailPage } from '../../pages/SopDetailPage'
import { PreviewDialog } from '../workflow/PreviewDialog'
import { VersionHistory } from '../workflow/VersionHistory'
import { DocxViewer } from './DocxViewer'
import viewerSource from './DocxViewer.tsx?raw'

const fixture = vi.hoisted(() => ({
  user: { id: 'admin', name: 'Nouf', initials: 'NA', email: 'nouf@example.test', departmentId: 'it', permissions: ['admin'] } as User,
  it: { id: 'it', name: 'Information Technology', initials: 'IT', description: '' } as Department,
  sops: [] as Sop[],
  fileUrl: 'blob:http://localhost/doc' as string | undefined,
}))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => fixture.user }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ getDepartment: () => fixture.it, nameOf: () => fixture.it.name, departments: [fixture.it] }) }))
vi.mock('../../state/requestsContext', () => ({ useMyRequests: () => [] }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: fixture.sops }) }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ nameOf: () => 'Sara' }) }))
vi.mock('../../hooks/useFileUrl', () => ({ useFileUrl: () => fixture.fileUrl, currentVersionOf: (sop: Sop) => sop.versions.find((v) => v.version === sop.version) }))

const sop = (fileType: Sop['fileType']): Sop => ({
  id: '79', code: 'SOP-079', title: 'Data Integrity', authorId: 'sara', coAuthorIds: [], departmentId: 'it', status: 'published', version: '1',
  lastUpdated: '2026-10-01', fileName: `SOP-079.${fileType}`, fileType, reviewers: [], approvers: [], timeline: [], comments: [], complianceChecks: [],
  versions: [{ version: '1', fileName: `SOP-079.${fileType}`, fileType, uploadedAt: '2026-10-01T09:00:00Z', uploadedById: 'sara', storagePath: `sara/79.${fileType}` }],
})
const detail = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/sops/79']}><Routes><Route path="/admin/sops/:id" element={<SopDetailPage admin />} /></Routes></MemoryRouter>)
const text = { loading: 'Loading…', failed: "The file couldn't be opened. Try again." }

beforeEach(() => {
  fixture.fileUrl = 'blob:http://localhost/doc'
})

describe('links in a Word preview', () => {
  it('keeps only http(s), mailto and in-document links', () => {
    for (const safe of ['https://www.sfda.gov.sa/gvp', 'http://example.com/a', 'mailto:qa@example.com', '#section-2', '  https://example.com  ']) {
      expect(isSafeDocxHref(safe), safe).toBe(true)
    }
    for (const unsafe of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>', 'file:///C:/secret.txt', 'other-page.html', '/admin', '#', '', null]) {
      expect(isSafeDocxHref(unsafe), String(unsafe)).toBe(false)
    }
  })

  it('turns a javascript: link into plain text, keeping its words, and leaves safe links alone', () => {
    const replaced: unknown[][] = []
    const link = (href: string | null, words: string) => ({
      getAttribute: (name: string) => (name === 'href' ? href : null),
      childNodes: [words],
      replaceWith: (...nodes: never[]) => { replaced.push([href, ...nodes]) },
    })
    const links = [link('javascript:alert(document.cookie)', 'Click me'), link('https://www.sfda.gov.sa', 'SFDA'), link('#scope', 'Scope'), link(null, 'Bookmark')]
    expect(sanitizeDocxLinks({ querySelectorAll: () => links })).toBe(2)
    expect(replaced).toEqual([['javascript:alert(document.cookie)', 'Click me'], [null, 'Bookmark']])
  })
})

describe('the Word preview', () => {
  it('loads docx-preview only when a Word file is shown (a separate chunk)', () => {
    expect(viewerSource).toContain("import('docx-preview')")
    expect(viewerSource).not.toMatch(/^import [^\n]* from 'docx-preview'/m)
  })

  it('says it is loading, then shows a labelled region that can be scrolled with the keyboard, with no headings', () => {
    const html = renderToStaticMarkup(<DocxViewer url="blob:x" fileKey="k" label="Data Integrity (Word document preview)" text={text} />)
    expect(html).toContain('<div role="status"><p class="px-1 py-2 text-sm text-text-gray">Loading…</p></div>')
    expect(html).toMatch(/<div role="region" aria-label="Data Integrity \(Word document preview\)" tabindex="0" hidden="" class="docx-preview overflow-auto rounded-lg bg-beige h-\[70vh\] min-h-\[28rem\]">/)
    expect(html).not.toMatch(/<h[1-6]/)
  })

  it('fits the page width, renders no comments, tracked changes or embedded HTML, and scopes its styles', () => {
    for (const option of ["className: CLASS_NAME", 'ignoreWidth: true', 'renderComments: false', 'renderChanges: false', 'renderAltChunks: false', 'useBase64URL: true']) {
      expect(viewerSource, option).toContain(option)
    }
    expect(viewerSource).toContain("const CLASS_NAME = 'hawkim-docx'")
    // Unsafe links are removed before the rendered document is put on the page.
    expect(viewerSource.indexOf('sanitizeDocxLinks(content)')).toBeLessThan(viewerSource.indexOf('body.replaceChildren(...content.childNodes)'))
  })
})

describe('where Word files are shown', () => {
  it('on the SOP page: the preview with Download beside it, instead of "not available"', () => {
    fixture.sops = [sop('docx')]
    const html = detail()
    expect(html).not.toContain('Preview isn')
    expect(html).toContain('>Download Document<')
    expect(html).toContain('aria-label="Data Integrity (Word document preview)"')
    expect(html.indexOf('>Download Document<')).toBeLessThan(html.indexOf('role="region"'))
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).not.toContain('<iframe')
  })

  it('keeps PDFs in the PDF viewer', () => {
    fixture.sops = [sop('pdf')]
    const html = detail()
    expect(html).toContain('<iframe')
    expect(html).not.toContain('Word document preview')
  })

  it('in the version history: Preview is enabled for Word files', () => {
    const html = renderToStaticMarkup(<VersionHistory sop={sop('docx')} content={sopWorkflowEn} userId="sara" deleteReason={() => undefined} onPreview={() => {}} onDownload={() => {}} onDelete={() => {}} />)
    const preview = html.match(/<button type="button"[^>]*aria-label="Preview v1"[^>]*>/)![0]
    expect(preview).not.toContain('aria-disabled="true"')
    expect(html).not.toContain('Preview isn’t available')
  })

  it('in the preview dialog: the Word preview for a Word version, the PDF viewer otherwise', () => {
    const fallback = sopWorkflowEn.history.fallback
    const word = renderToStaticMarkup(<PreviewDialog title="t" url="blob:x" viewerTitle="Data Integrity, v1 (Word document preview)" closeLabel="Close" fallback={fallback} docx={{ fileKey: 'k', text }} onClose={() => {}} />)
    expect(word).toContain('aria-label="Data Integrity, v1 (Word document preview)"')
    expect(word).not.toContain('<iframe')
    const pdf = renderToStaticMarkup(<PreviewDialog title="t" url="blob:x" viewerTitle="Data Integrity, v1 (PDF)" closeLabel="Close" fallback={fallback} onClose={() => {}} />)
    expect(pdf).toContain('<iframe')
  })
})
