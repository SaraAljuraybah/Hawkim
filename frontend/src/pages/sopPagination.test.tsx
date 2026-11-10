import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Department, Sop, User } from '../data/mock/types'
import { MySopsPage } from './MySopsPage'
import { SopsPage } from './SopsPage'

const fixture = vi.hoisted(() => ({
  user: { id: 'me', name: 'Main Author', initials: 'MA', email: 'me@example.test', departmentId: 'home', permissions: ['author', 'reviewer'] } as User,
  home: { id: 'home', name: 'Home Department', initials: 'HM', description: '' } as Department,
  sops: [] as Sop[],
  view: 'grid',
}))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.user, useSession: () => ({ status: 'signed-in', user: fixture.user }) }))
vi.mock('../state/activeDepartmentContext', () => ({ useActiveDepartment: () => ({
  activeDepartment: fixture.home, homeDepartment: fixture.home, directoryDepartments: [fixture.home], setActiveDepartment: vi.fn(),
}) }))
vi.mock('../state/requestsContext', () => ({ useMyRequests: () => [], useRequests: () => ({ requests: [] }) }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: fixture.sops, deleteSop: vi.fn() }) }))
vi.mock('../state/guidelinesContext', () => ({ useGuidelines: () => ({ current: { version: '4.0' } }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [fixture.home], activeDepartments: [fixture.home], nameOf: () => fixture.home.name }) }))

/** `count` SOPs, "Procedure 01" the oldest; newest first is the highest number. */
function sops(count: number, status: Sop['status'], extra: (n: number) => Partial<Sop> = () => ({})): Sop[] {
  return Array.from({ length: count }, (_, index) => {
    const n = String(index + 1).padStart(2, '0')
    return {
      id: `${status}-${n}`, code: `C-${status}-${n}`, title: `Procedure ${n}`, authorId: 'me', coAuthorIds: [], departmentId: 'home', status, version: '1',
      lastUpdated: `2026-10-${n}`, fileName: 'a.pdf', fileType: 'pdf', versions: [], reviewers: [], approvers: [], timeline: [], comments: [], complianceChecks: [],
      ...extra(index + 1),
    }
  })
}
function render(page: ReactNode, url: string) {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[url]}>{page}</MemoryRouter>)
}
/** The SOP titles shown in the tab panel, in order. */
function shown(html: string): string[] {
  const panel = html.slice(html.indexOf('role="tabpanel"'), html.indexOf('</div><nav') === -1 ? undefined : html.indexOf('</div><nav'))
  return [...new Set([...panel.matchAll(/>(Procedure \d\d)</g)].map((match) => match[1]))]
}
const numbers = (from: number, to: number) =>
  Array.from({ length: from - to + 1 }, (_, index) => `Procedure ${String(from - index).padStart(2, '0')}`)
/** The value chosen in the select with this name. */
const selected = (html: string, name: string) =>
  html.match(new RegExp(`<select[^>]*name="${name}"[^>]*>.*?</select>`))![0].match(/<option(?=[^>]*selected="")[^>]*value="([^"]+)"/)?.[1]
const currentPage = (html: string) => html.match(/aria-current="page"[^>]*>(\d+)</)?.[1]

beforeEach(() => {
  fixture.view = 'grid'
  vi.stubGlobal('localStorage', { getItem: () => fixture.view, setItem: () => {} })
})

describe.each([
  ['My SOPs', MySopsPage, '/my-sops', 'draft'],
  ['the SOP Directory', SopsPage, '/sops', 'published'],
] as const)('pagination on %s', (_name, Page, path, status) => {
  const page = <Page />
  it.each(['grid', 'list'])('shows 12 SOPs per page in the %s view, newest first', (view) => {
    fixture.view = view
    fixture.sops = sops(30, status)
    const html = render(page, path)
    expect(shown(html)).toEqual(numbers(30, 19))
    expect(currentPage(html)).toBe('1')
    expect(html).toContain('<nav aria-label="Pagination"')
  })

  it('opens the page in the URL', () => {
    fixture.sops = sops(30, status)
    const second = render(page, `${path}?page=2`)
    expect(shown(second)).toEqual(numbers(18, 7))
    expect(currentPage(second)).toBe('2')
    expect(shown(render(page, `${path}?page=3`))).toEqual(numbers(6, 1))
  })

  it('shows the last page for a page that is too high, and page 1 for an invalid one', () => {
    fixture.sops = sops(30, status)
    expect(shown(render(page, `${path}?page=9`))).toEqual(numbers(6, 1))
    for (const value of ['abc', '0', '-2', '1.5']) expect(shown(render(page, `${path}?page=${value}`))).toEqual(numbers(30, 19))
  })

  it.each([1, 12])('always shows the controls, "‹ Previous 1 Next ›" with both disabled, for one page (%i SOPs)', (count) => {
    fixture.sops = sops(count, status)
    const html = render(page, path)
    expect(shown(html)).toHaveLength(count)
    expect(html).toContain('aria-label="Pagination"')
    expect(currentPage(html)).toBe('1')
    expect(html).not.toContain('aria-label="Page 2"')
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*aria-label="Previous page"|<button[^>]*aria-label="Previous page"[^>]*aria-disabled="true"/)
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*aria-label="Next page"|<button[^>]*aria-label="Next page"[^>]*aria-disabled="true"/)
  })

  it('hides the controls when there are no results, keeping the empty message', () => {
    fixture.sops = []
    expect(render(page, path)).not.toContain('aria-label="Pagination"')
    fixture.sops = sops(5, status)
    const html = render(page, `${path}?q=nothing-matches`)
    expect(shown(html)).toHaveLength(0)
    expect(html).not.toContain('aria-label="Pagination"')
  })

  it('keeps the existing result count for the whole list, and no "Showing" text', () => {
    fixture.sops = sops(30, status)
    const html = render(page, `${path}?page=2`)
    expect(html).toContain('30 SOPs found')
    expect(html).not.toContain('Showing')
  })

  it('paginates the search results, and restores the search and sort from the URL', () => {
    fixture.sops = [...sops(20, status), ...sops(20, status, (n) => ({ id: `other-${n}`, code: `X-${n}`, title: `Checklist ${n}` }))]
    const html = render(page, `${path}?q=procedure&sort=oldest&page=2`)
    expect(shown(html)).toEqual(['Procedure 13', 'Procedure 14', 'Procedure 15', 'Procedure 16', 'Procedure 17', 'Procedure 18', 'Procedure 19', 'Procedure 20'])
    expect(html).toContain('20 SOPs found')
    expect(html).toMatch(/<input[^>]*value="procedure"/)
    expect(selected(html, path === '/sops' ? 'sopSort' : 'mySopSort')).toBe('oldest')
  })
})

describe('My SOPs tabs and filters in the URL', () => {
  beforeEach(() => {
    fixture.sops = [...sops(15, 'draft'), ...sops(30, 'in-review', (n) => ({ id: `review-${n}`, coAuthorIds: n % 2 ? [] : ['someone'], authorId: n % 2 ? 'me' : 'someone' }))]
    fixture.sops = fixture.sops.map((sop) => sop.authorId === 'someone' ? { ...sop, coAuthorIds: ['me'] } : sop)
  })

  it('restores the tab and its page from the URL; the default tab adds nothing', () => {
    const html = render(<MySopsPage />, '/my-sops?tab=progress&page=3')
    expect(html).toContain('aria-labelledby="my-sops-tab-progress"')
    expect(shown(html)).toEqual(numbers(6, 1))
    expect(render(<MySopsPage />, '/my-sops')).toContain('aria-labelledby="my-sops-tab-new"')
  })

  it('restores My Role from the URL, with each tab paginated on its own', () => {
    const html = render(<MySopsPage />, '/my-sops?tab=progress&role=main&page=2')
    expect(selected(html, 'mySopRole')).toBe('main')
    expect(html).toContain('15 SOPs found')
    expect(shown(html)).toEqual(['Procedure 05', 'Procedure 03', 'Procedure 01'])
  })

  it('falls back to the defaults for invalid values in the URL', () => {
    const html = render(<MySopsPage />, '/my-sops?tab=archived&role=owner&sort=random&page=x')
    expect(html).toContain('aria-labelledby="my-sops-tab-new"')
    expect(selected(html, 'mySopRole')).toBe('all')
    expect(selected(html, 'mySopSort')).toBe('newest')
    expect(shown(html)).toEqual(numbers(15, 4))
  })

  it('shows the previous page once the last SOP of the last page is deleted', () => {
    fixture.sops = sops(25, 'draft')
    expect(shown(render(<MySopsPage />, '/my-sops?page=3'))).toEqual(['Procedure 01'])
    fixture.sops = fixture.sops.filter((sop) => sop.title !== 'Procedure 01')
    const html = render(<MySopsPage />, '/my-sops?page=3')
    expect(currentPage(html)).toBe('2')
    expect(shown(html)).toEqual(numbers(13, 2))
  })
})

describe('the SOP Directory tabs and filters in the URL', () => {
  beforeEach(() => {
    fixture.sops = [...sops(20, 'published'), ...sops(20, 'published', (n) => ({ id: `word-${n}`, code: `W-${n}`, title: `Word ${n}`, fileType: 'docx' }))]
  })

  it('restores the tab, the sort and the page from the URL', () => {
    const html = render(<SopsPage />, '/sops?tab=recent&sort=oldest&page=2')
    expect(html).toContain('aria-labelledby="sops-tab-recent"')
    expect(selected(html, 'sopSort')).toBe('oldest')
    expect(html).toContain('40 SOPs found')
    expect(currentPage(html)).toBe('2')
  })

  it('has no File Type filter, and ignores it in an old link: PDF and Word SOPs are both listed', () => {
    for (const url of ['/sops', '/sops?type=pdf', '/sops?type=docx&page=1', '/sops?type=xls']) {
      const html = render(<SopsPage />, url)
      expect(html).not.toContain('name="documentType"')
      expect(html).not.toContain('Document Type')
      expect(html).toContain('40 SOPs found')
      expect(html).not.toContain('Clear Filters')
    }
    // Search and Sort stay.
    const html = render(<SopsPage />, '/sops')
    expect(html).toContain('name="sopSearch"')
    expect(html).toContain('name="sopSort"')
  })

  it('falls back to the defaults for invalid values, and to All when there is no Others tab', () => {
    for (const url of ['/sops?tab=mine&type=xls&sort=az', '/sops?tab=others']) {
      const html = render(<SopsPage />, url)
      expect(html).toContain('aria-labelledby="sops-tab-all"')
      expect(selected(html, 'sopSort')).toBe('newest')
      expect(html).toContain('40 SOPs found')
    }
  })
})
