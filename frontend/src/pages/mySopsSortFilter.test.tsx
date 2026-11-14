import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Sop, User } from '../data/mock/types'
import { clearedMySopsParams, readMySopsUrl, sortMySops } from '../lib/mySops'
import { MySopsPage } from './MySopsPage'

const fixture = vi.hoisted(() => ({
  user: { id: 'me', name: 'Main Author', initials: 'MA', email: 'me@example.test', departmentId: 'home', permissions: ['author'] } as User,
  sops: [] as Sop[],
}))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.user }))
vi.mock('../state/activeDepartmentContext', () => ({ useActiveDepartment: () => ({ homeDepartment: { id: 'home', name: 'Home department' }, activeDepartment: { id: 'home', name: 'Home department' } }) }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: fixture.sops, deleteSop: vi.fn() }) }))
vi.mock('../state/guidelinesContext', () => ({ useGuidelines: () => ({ current: { version: '4.0' } }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [{ id: 'home', name: 'Home department', requiresComplianceCheck: true }] }) }))

function sop(id: string, title: string, lastUpdated: string, authorId = 'me'): Sop {
  return {
    id, code: `C-${id}`, title, authorId, coAuthorIds: authorId === 'me' ? [] : ['me'], departmentId: 'home', status: 'draft', version: '1', lastUpdated,
    fileName: 'a.pdf', fileType: 'pdf', versions: [], reviewers: [], approvers: [], timeline: [], comments: [], complianceChecks: [],
  }
}
const render = (search = '') => renderToStaticMarkup(<MemoryRouter initialEntries={[`/my-sops${search}`]}><MySopsPage /></MemoryRouter>)
const TITLES = ['Audit Trail', 'Batch Release', 'Change Control']
/** The SOP titles shown in the tab panel, in order. */
function titles(html: string): string[] {
  const panel = html.slice(html.indexOf('role="tabpanel"'))
  return TITLES.filter((title) => panel.includes(`>${title}<`)).sort((a, b) => panel.indexOf(`>${a}<`) - panel.indexOf(`>${b}<`))
}
const sortField = (html: string) => html.match(/<select[^>]*name="mySopSort"[^>]*>.*?<\/select>/)![0]

beforeEach(() => {
  fixture.sops = [
    sop('b', 'Batch Release', '2026-10-03'),
    sop('a', 'Audit Trail', '2026-10-01', 'other'),
    sop('c', 'Change Control', '2026-10-02'),
  ]
})

describe('the My SOPs Sort field', () => {
  it('is labelled Sort, with Last Updated and Title groups, Newest to Oldest first and by default', () => {
    const html = render()
    expect(html).toMatch(/<label[^>]*>Sort<\/label>/)
    expect(sortField(html)).toMatch(
      /<optgroup label="Last Updated"><option[^>]*value="newest"[^>]*>Newest to Oldest<\/option><option[^>]*value="oldest"[^>]*>Oldest to Newest<\/option><\/optgroup><optgroup label="Title"><option[^>]*value="title-asc"[^>]*>A to Z<\/option><option[^>]*value="title-desc"[^>]*>Z to A<\/option><\/optgroup>/,
    )
    expect(sortField(html)).toMatch(/<option[^>]*value="newest"[^>]*selected=""/)
    expect(titles(html)).toEqual(['Batch Release', 'Change Control', 'Audit Trail'])
  })

  it.each([
    ['?sort=oldest', ['Audit Trail', 'Change Control', 'Batch Release']],
    ['?sort=title-asc', ['Audit Trail', 'Batch Release', 'Change Control']],
    ['?sort=title-desc', ['Change Control', 'Batch Release', 'Audit Trail']],
  ])('orders the SOPs from the URL (%s)', (search, expected) => {
    const html = render(search)
    expect(titles(html)).toEqual(expected)
    expect(sortField(html)).toMatch(new RegExp(`<option[^>]*value="${search.slice(6)}"[^>]*selected=""`))
  })

  it('keeps SOPs with the same title newest first, and never changes the list it was given', () => {
    const same = [sop('new', 'Same', '2026-10-05'), sop('old', 'Same', '2026-10-01'), sop('z', 'Another', '2026-10-03')]
    expect(sortMySops(same, 'title-asc').map((item) => item.id)).toEqual(['z', 'new', 'old'])
    expect(sortMySops(same, 'title-desc').map((item) => item.id)).toEqual(['new', 'old', 'z'])
    expect(same.map((item) => item.id)).toEqual(['new', 'old', 'z'])
  })

  it('treats an unknown sort in the URL as Newest to Oldest', () => {
    expect(readMySopsUrl(new URLSearchParams('sort=az')).sort).toBe('newest')
    expect(titles(render('?sort=title'))).toEqual(['Batch Release', 'Change Control', 'Audit Trail'])
  })
})

describe('Clear Filters on My SOPs, as on Staff and Admins', () => {
  it('shows when a sort other than Newest to Oldest is chosen, not for the default', () => {
    expect(render('?sort=oldest')).toContain('>Clear Filters<')
    expect(render('?sort=title-asc')).toContain('>Clear Filters<')
    expect(render()).not.toContain('>Clear Filters<')
    expect(render('?sort=newest')).not.toContain('>Clear Filters<')
  })

  it('resets the search, the role and the sort, back to page 1, and keeps the tab', () => {
    const cleared = clearedMySopsParams(new URLSearchParams('tab=progress&q=audit&role=main&sort=title-desc&page=2'))
    expect(cleared.toString()).toBe('tab=progress')
  })
})
