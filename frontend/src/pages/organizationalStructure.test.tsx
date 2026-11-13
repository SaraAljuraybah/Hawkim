import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '../components/layout/Sidebar'
import { OrganizationTable } from '../components/layout/OrganizationTable'
import { adminEn } from '../content/admin.en'
import { organizationRows, type OrganizationFilters } from '../lib/organization'
import type { OrganizationHierarchy } from '../services/organization'
import { OrganizationalStructurePage, OrganizationContent, OrganizationStructure } from './OrganizationalStructurePage'
import { navLinks } from '../lib/sidebarNav'

vi.mock('../state/sessionContext', () => ({ useSession: () => ({ signOut: vi.fn() }), useCurrentUser: () => ({ id: 'admin' }) }))
const headingFixture = vi.hoisted(() => ({ name: { status: 'ready', name: null } as { status: string; name: string | null }, titles: [] as string[] }))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: (title?: string) => { if (title) headingFixture.titles.push(title) } }))
// The organization's name, as the top bar reads it (get_organization_name).
vi.mock('../hooks/useOrganizationName', () => ({ useOrganizationName: () => ({ ...headingFixture.name, set: () => {} }) }))
const hierarchy: OrganizationHierarchy = {
  organization: null,
  divisions: [{ id: 'division-1', name: 'Operations', email: 'ops@test.invalid' }, { id: 'division-2', name: 'R and D Division', email: null }],
  departments: [
    { id: 'department-1', name: 'Quality', divisionId: 'division-1', email: 'quality@test.invalid', employees: [
      { id: 'person-1', name: 'Dana Fahad', initials: 'DF', email: 'dana@test.invalid', position: 'Specialist', permissions: ['author', 'reviewer'] },
      { id: 'person-2', name: 'No Role Person', initials: 'NR', email: 'norole@test.invalid', permissions: [] },
    ] },
    { id: 'department-2', name: 'Empty Department', divisionId: 'division-1', employees: [] },
  ],
}
const page = (value = hierarchy) => renderToStaticMarkup(<OrganizationStructure hierarchy={value} />)
const table = (filters: Partial<OrganizationFilters>, value = hierarchy) => {
  const all = { query: '', divisions: [], departments: [], roles: [], ...filters }
  return renderToStaticMarkup(<OrganizationTable rows={organizationRows(value, all)} filtering filterKey="test" />)
}

describe('Organizational Structure', () => {
  it('puts Organizational Structure right after Organization Profile and before Manage Organization, with its existing active indicator', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/organizational-structure']}><Sidebar content={adminEn.shell} /></MemoryRouter>)
    expect(adminEn.shell.nav[1]?.label).toBe('Organizational Structure')
    const labels = navLinks(adminEn.shell.nav).map((item) => item.label)
    expect(labels.indexOf('Organizational Structure')).toBe(labels.indexOf('Organization Profile') + 1)
    expect(html.indexOf('>Organization Profile<')).toBeLessThan(html.indexOf('>Organizational Structure<'))
    expect(html.indexOf('>Organizational Structure<')).toBeLessThan(html.indexOf('Manage Organization'))
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/admin\/organizational-structure"/)
  })
  it('has one h1, then the short description, and no tree', () => {
    const html = renderToStaticMarkup(<OrganizationalStructurePage />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('Organizational Structure</h1><p class="mt-2 text-text-gray">Browse the organization&#x27;s divisions, departments and staff, and view their information.</p>')
    for (const removed of ['org-root', 'org-branches', '<details', '>Organization<']) expect(page()).not.toContain(removed)
  })
  it('names the heading and the tab title after the organization, e.g. "Sitco Structure"', () => {
    headingFixture.name = { status: 'ready', name: 'Sitco' }
    headingFixture.titles.length = 0
    const html = renderToStaticMarkup(<OrganizationalStructurePage />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toMatch(/<h1 class="[^"]*break-words[^"]*">Sitco Structure<\/h1>/)
    expect(headingFixture.titles.at(-1)).toBe('Sitco Structure | Hawkim')
    renderToStaticMarkup(<OrganizationalStructurePage admin />)
    expect(headingFixture.titles.at(-1)).toBe('Sitco Structure · Admin Portal | Hawkim')
    headingFixture.name = { status: 'ready', name: null }
  })
  it.each([
    ['no name saved', { status: 'ready', name: null }],
    ['a blank name', { status: 'ready', name: '   ' }],
    ['the name still loading', { status: 'loading', name: null }],
    ['the name failing to load', { status: 'error', name: null }],
  ])('falls back to "Organizational Structure" with %s', (_case, name) => {
    headingFixture.name = name
    headingFixture.titles.length = 0
    const html = renderToStaticMarkup(<OrganizationalStructurePage />)
    expect(html).toMatch(/<h1 class="[^"]*">Organizational Structure<\/h1>/)
    expect(headingFixture.titles.at(-1)).toBe('Organizational Structure | Hawkim')
    headingFixture.name = { status: 'ready', name: null }
  })
  it('keeps the sidebar item as "Organizational Structure"', () => {
    headingFixture.name = { status: 'ready', name: 'Sitco' }
    expect(navLinks(adminEn.shell.nav).find((item) => item.href === '/admin/organizational-structure')?.label).toBe('Organizational Structure')
    headingFixture.name = { status: 'ready', name: null }
  })
  it('shows a Name | Email table with no Users, SOPs or action columns', () => {
    const html = page()
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'))
    expect([...head.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((match) => match[1])).toEqual(['Name', 'Email'])
    for (const text of ['>Users<', '>SOPs<', 'lucide-pencil', 'lucide-trash', 'lucide-plus', 'lucide-eye']) expect(html).not.toContain(text)
  })
  it('shows divisions with their department count and email, or "—" when there is none', () => {
    const html = page()
    expect(html).toContain('>Operations</span>')
    expect(html).toContain('>Departments (2)</span>')
    expect(html).toContain('>Departments (0)</span>')
    expect(html).toContain('R and D Division')
    expect(html).toContain('title="ops@test.invalid"')
    expect(html).toContain('aria-label="Copy email for Operations"')
    expect(html).toContain('<span aria-hidden="true">—</span><span class="sr-only">No email</span>')
  })
  it('starts with everything collapsed, each level a real toggle button', () => {
    const html = page()
    const toggles = html.slice(html.indexOf('<table')).match(/<button type="button" aria-expanded="[^"]+"[^>]*>/g)!
    // 2 divisions, 2 departments: all closed.
    expect(toggles).toHaveLength(4)
    for (const toggle of toggles) expect(toggle).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls="org-children-division-1"')
    expect(html).toMatch(/<tbody id="org-children-division-1" hidden="">/)
    expect(html).toContain('aria-controls="org-staff-department-1"')
    expect(html).toMatch(/<tr id="org-staff-department-1" hidden=""/)
  })
  it('shows departments with their staff count and email, and "No staff in this department"', () => {
    const html = page()
    expect(html).toContain('>Staff (2)</span>')
    expect(html).toContain('>Staff (0)</span>')
    expect(html).toContain('aria-label="Copy email for Quality"')
    expect(html).toContain('No staff in this department')
    expect(html).not.toContain('Employee')
    expect(html).not.toContain('>Users')
  })
  it('shows each person with avatar, name, roles and email with a copy button; nothing under a name without a role', () => {
    const html = table({ query: 'dana' })
    expect(html).toMatch(/<tr id="org-staff-department-1" class=/)
    const row = html.match(/<tr class="border-t border-beige first:border-t-0">(?:(?!<\/tr>).)*Dana Fahad.*?<\/tr>/)![0]
    expect(row).toContain('>DF</span>')
    // The name opens their Profile Preview: a real button, named for what it does, that looks clickable (always
    // underlined, pointer cursor; the app's focus outline applies to every focusable element).
    const name = row.match(/<button type="button" aria-haspopup="dialog" aria-label="View Dana Fahad’s profile" class="([^"]*)"[^>]*>Dana Fahad<\/button>/)!
    expect(name[1].split(' ')).toEqual(expect.arrayContaining(['cursor-pointer', 'rounded-sm', 'text-maroon', 'underline', 'underline-offset-2']))
    expect(name[1]).not.toContain('hover:underline')
    // Only staff names: the division and department buttons (they open and close) aren't underlined.
    for (const toggle of html.match(/<button type="button" aria-expanded="[^"]+"[^>]*>/g)!) expect(toggle).not.toContain('underline')
    expect(row).toContain('Permissions: </span>Author, Reviewer</span>')
    // The copy button right after the email (which truncates, never pushing the button out of view).
    expect(row).toContain('<span title="dana@test.invalid" class="min-w-0 truncate">dana@test.invalid</span><span class="contents">')
    expect(row).toContain('aria-label="Copy email for Dana Fahad"')
    expect(row).toContain('aria-live="polite"')
    expect(row).not.toContain('Specialist')
    const noRole = table({ query: 'no role' }).match(/<tr class="border-t border-beige first:border-t-0">(?:(?!<\/tr>).)*No Role Person.*?<\/tr>/)![0]
    expect(noRole).toContain('>No Role Person</button></span>')
    expect(noRole).not.toContain('Permissions:')
    expect(noRole).not.toContain('Employee')
  })
  it('opens the rows needed to show search results, and shows only the matches', () => {
    const html = table({ query: 'dana' })
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(2)
    expect(html).not.toContain('No Role Person')
    expect(html).not.toContain('Empty Department')
    expect(html).not.toContain('R and D Division')
  })
  it('shows an empty state when nothing matches', () => {
    expect(table({ query: 'nobody' })).toContain('No divisions, departments or staff match your search and filters.')
    expect(renderToStaticMarkup(<OrganizationTable rows={[]} filtering={false} filterKey="" />)).toContain('No divisions or departments have been configured yet.')
  })
  it('adds an "Unassigned departments" group row last, only when such a department exists', () => {
    expect(page()).not.toContain('Unassigned departments')
    const data = structuredClone(hierarchy)
    data.departments.push({ id: 'department-3', name: 'Legacy Unit', divisionId: null, employees: [] })
    const html = page(data)
    expect(html).toContain('<th scope="colgroup" colSpan="2" class="bg-beige/20 p-4 text-maroon">Unassigned departments</th>')
    expect(html.indexOf('Unassigned departments')).toBeGreaterThan(html.indexOf('R and D Division'))
    expect(html.indexOf('Legacy Unit')).toBeGreaterThan(html.indexOf('Unassigned departments'))
  })
  it('has one search and a Filter button with Division and Role chips', () => {
    const html = page()
    expect(html.match(/type="search"/g)).toHaveLength(1)
    expect(html).toContain('placeholder="Search divisions, departments or staff by name or email"')
    // A visible "Filter" label, like Sort's, for a field like the other dropdowns ("All" and a chevron).
    const button = html.match(/<label for="([^"]+)" class="mb-1.5 block text-sm font-medium text-maroon">Filter<\/label><button id="([^"]+)" type="button" aria-label="Filter" aria-expanded="false" aria-controls="[^"]+"[^>]*>(.*?)<\/button>/)!
    expect(button[1]).toBe(button[2])
    expect(button[0]).toContain('min-h-11')
    expect(button[3]).toContain('>All</span>')
    expect(button[3]).toContain('lucide-chevron-down')
    expect(button[3]).not.toContain('lucide-funnel')
    expect([...html.matchAll(/<legend[^>]*>([^<]+)<\/legend>/g)].map((match) => match[1])).toEqual(['Division', 'Department', 'Staff permission'])
    const chips = [...html.matchAll(/aria-pressed="false"[^>]*><span class="min-w-0 break-words">([^<]+)<\/span>/g)].map((match) => match[1])
    expect(chips).toEqual(['Operations', 'R and D Division', 'Empty Department', 'Quality', 'Author', 'Reviewer', 'Approver', 'Others'])
    // Departments under their division's subheading; Division and Department chips scroll inside their cards.
    expect(html).toMatch(/<p id="[^"]+" class="mb-1.5 text-xs font-semibold text-text-gray">Operations<\/p>/)
    expect(html.match(/max-h-\[8.5rem\] overflow-y-auto/g)).toHaveLength(2)
    // The panel is right-aligned with the toolbar (positioned from lg), 22.5rem wide from sm, and scrolls when taller than the screen.
    expect(html).toMatch(/<div class="mt-6 relative grid gap-4 [^"]*"><div class="[^"]*"><label/)
    expect(html).toContain('<div class="relative min-w-0 lg:static">')
    expect(html).toContain('absolute top-full right-0 left-0 z-30 mt-2 max-h-[calc(100vh-10rem)] overflow-y-auto')
    expect(html).toContain('sm:left-auto sm:w-[22.5rem] sm:max-w-full')
    // Chip text is left-aligned when a long name wraps.
    expect(html).toMatch(/aria-pressed="false" class="inline-flex [^"]*text-left/)
    expect(html).toContain('>Clear all</button>')
  })
  it('offers the default order, then each group (saying what it sorts) with its two directions', () => {
    const select = page().match(/<select[^>]*name="organizationSort"[^>]*>([\s\S]*?)<\/select>/)![1]
    const groups = [...select.matchAll(/<optgroup label="([^"]+)">([\s\S]*?)<\/optgroup>/g)]
      .map((group) => [group[1], [...group[2].matchAll(/>([^<]+)<\/option>/g)].map((option) => option[1])])
    expect(groups).toEqual([
      ['Division name', ['A to Z', 'Z to A']],
      ['Division departments', ['High to low', 'Low to high']],
      ['Department name', ['A to Z', 'Z to A']],
      ['Department staff', ['High to low', 'Low to high']],
    ])
    expect(select).toMatch(/^<option value="default"[^>]*>Default order<\/option><optgroup/)
  })
  it('lists unassigned departments under their own subheading in the Department filter', () => {
    const data = structuredClone(hierarchy)
    data.departments.push({ id: 'department-3', name: 'Legacy Unit', divisionId: null, employees: [] })
    const html = page(data)
    expect(html).toMatch(/text-xs font-semibold text-text-gray">Unassigned departments<\/p><ul[^>]*><li[^>]*><button type="button" aria-pressed="false"[^>]*><span class="min-w-0 break-words">Legacy Unit</)
  })
  it('puts the staff of each department in a named table of their own, in a box about 6 rows tall that can scroll', () => {
    const html = table({ query: 'dana' })
    const row = html.match(/<tr id="org-staff-department-1"[^>]*><td colSpan="2" class="p-0">(.*?)<\/td><\/tr><\/tbody>/)![1]
    // Only the staff box scrolls (the division and department rows stay in place).
    expect(row).toMatch(/^<div class="max-h-\[22.5rem\] overflow-y-auto overscroll-contain">/)
    // Before measuring (and whenever it fits) it is not a tab stop.
    expect(row).not.toContain('tabindex=')
    expect(row).toContain('<table aria-label="Staff of Quality" class="w-full table-fixed text-left text-sm"><colgroup><col style="width:60%"/><col/></colgroup>')
    // Screen-reader-only column headers, and each person is still a row header.
    expect(row).toContain('<thead class="sr-only"><tr><th scope="col">Name</th><th scope="col">Email</th></tr></thead>')
    expect(row).toMatch(/<th scope="row"[^>]*>.*Dana Fahad/)
  })
  it('renders loading skeletons and a clear retry state', () => {
    expect(renderToStaticMarkup(<OrganizationContent state={{ status: 'loading' }} reload={() => {}} />)).toContain('role="status"')
    const html = renderToStaticMarkup(<OrganizationContent state={{ status: 'error' }} reload={() => {}} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('>Retry<')
  })
})
