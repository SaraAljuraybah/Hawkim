import { describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { ManagementSnapshot } from '../../services/organizationAdmin'
import { ActiveFilters, AdminDepartmentsPage, HierarchyTable } from './AdminDepartmentsPage'

const management = vi.hoisted(() => ({ value: {} as { data?: unknown; error?: string; refresh: () => Promise<void> } }))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../hooks/useOrganizationManagement', () => ({ useOrganizationManagement: () => management.value }))

const snapshot: ManagementSnapshot = {
  divisions: [
    { id: 'q', name: 'Quality & Compliance', description: '', email: null, updated_at: null, department_count: 1, employees: 3, sops: 2 },
    { id: 'c', name: 'Clinical Research & Development', description: '', email: null, updated_at: null, department_count: 1, employees: 5, sops: 7 },
  ],
  departments: [
    { id: 'qa', name: 'Quality Assurance', initials: 'QA', description: '', division_id: 'q', updated_at: 'r', employees: 3, sops: 2, status_counts: {} },
    { id: 'co', name: 'Clinical Operations', initials: 'CO', description: '', division_id: 'c', updated_at: 'r', employees: 5, sops: 7, status_counts: {} },
    { id: 'old', name: 'Legacy', initials: 'LG', description: '', division_id: null, updated_at: 'r', employees: 0, sops: 0, status_counts: {} },
  ],
}
const page = () => renderToStaticMarkup(<MemoryRouter><AdminDepartmentsPage /></MemoryRouter>)
const table = (props: Partial<Parameters<typeof HierarchyTable>[0]> = {}) => renderToStaticMarkup(<MemoryRouter>
  <HierarchyTable snapshot={snapshot} onEdit={vi.fn()} onPreview={vi.fn()} onViewDepartment={vi.fn()} onAddDepartment={vi.fn()} onEditDepartment={vi.fn()} onDeleteDivision={vi.fn()} onDeleteDepartment={vi.fn()} {...props} />
</MemoryRouter>)

describe('the Divisions and Departments page', () => {
  it('has only the heading (no subtitle) and Add Division', () => {
    management.value = { data: snapshot, refresh: vi.fn() }
    const html = page()
    expect(html.match(/<h1[^>]*>([^<]*)<\/h1>/)![1]).toBe('Divisions and Departments')
    expect(html).not.toContain('Manage divisions and their departments.')
    expect(html).toContain('Add Division')
  })

  it('has the toolbar of every list page: Search, Filter and Sort, in that order, above the table', () => {
    management.value = { data: snapshot, refresh: vi.fn() }
    const html = page()
    // One column on small screens; on large screens 2fr : 1fr : 1fr, as on every list page.
    const toolbar = html.match(/<div class="mt-6 relative grid gap-4 lg:grid-cols-\[minmax\(0,2fr\)_minmax\(0,1fr\)_minmax\(0,1fr\)\] lg:items-end">/)
    expect(toolbar).not.toBeNull()
    expect(toolbar![0]).not.toMatch(/(?<!lg:)grid-cols/)
    expect(html).not.toContain('max-w-md')
    const order = ['name="organizationSearch"', '>Filter</label>', 'name="divisionSort"', '<table']
    expect(order.map((text) => html.indexOf(text))).toEqual([...order.map((text) => html.indexOf(text))].sort((a, b) => a - b))
    expect(html).toContain('placeholder="Search divisions or departments..."')
  })

  it('offers the default order, then the Divisions and Departments sorts under their headings', () => {
    management.value = { data: snapshot, refresh: vi.fn() }
    const select = page().match(/<select[^>]*name="divisionSort"[^>]*>([\s\S]*?)<\/select>/)![1]
    expect(select.match(/>([^<]+)<\/option>/g)!.map((option) => option.slice(1, -9))).toEqual([
      'Default order',
      'A to Z', 'Z to A', 'Number of Staff', 'Number of SOPs',
      'A to Z', 'Z to A', 'Number of Staff', 'Number of SOPs',
    ])
    const groups = [...select.matchAll(/<optgroup label="([^"]+)">([\s\S]*?)<\/optgroup>/g)]
    expect(groups.map((group) => group[1])).toEqual(['Divisions', 'Departments'])
    expect(groups.map((group) => (group[2].match(/<option/g) ?? []).length)).toEqual([4, 4])
    expect(select.indexOf('Default order')).toBeLessThan(select.indexOf('<optgroup'))
  })

  it('has the Filter field of every list page with the Division section only, the loaded divisions as chips by name', () => {
    management.value = { data: snapshot, refresh: vi.fn() }
    const html = page()
    expect([...html.matchAll(/<legend[^>]*>([^<]+)<\/legend>/g)].map((match) => match[1])).toEqual(['Division'])
    const chips = [...html.matchAll(/aria-pressed="false"[^>]*><span class="min-w-0 break-words">([^<]+)<\/span>/g)].map((match) => match[1])
    expect(chips).toEqual(['Clinical Research &amp; Development', 'Quality &amp; Compliance'])
    expect(html).toMatch(/>Filter<\/label><button id="[^"]+" type="button" aria-label="Filter"[^>]*><span class="truncate text-text-gray">All<\/span>/)
    expect(html).not.toContain('All divisions')
  })

  it('keeps the Staff column label, loading state and Retry', () => {
    management.value = { data: snapshot, refresh: vi.fn() }
    expect(page()).toContain('>Staff</th>')
    management.value = { refresh: vi.fn() }
    expect(page()).not.toContain('<table')
    management.value = { error: 'boom', refresh: vi.fn() }
    const html = page()
    expect(html).toContain('Could not load organizational data. Try again.')
    expect(html).toContain('>Retry<')
  })
})

describe('the division filter on the table', () => {
  it('shows only the selected divisions, with their server totals, and hides unassigned departments', () => {
    const html = table({ divisions: ['q'] })
    expect(html).toContain('Quality &amp; Compliance')
    expect(html).not.toContain('Clinical Research')
    expect(html).not.toContain('Unassigned departments')
    expect(html).toMatch(/>3<\/td><td[^>]*>2<\/td>/)
  })

  it('shows several selected divisions (OR)', () => {
    const html = table({ divisions: ['q', 'c'] })
    expect(html).toContain('Quality &amp; Compliance')
    expect(html).toContain('Clinical Research &amp; Development')
  })

  it('combines with search and sort, and says when nothing matches', () => {
    const sorted = table({ divisions: ['q', 'c'], sort: 'division-sops-desc' })
    expect(sorted.indexOf('Clinical Research')).toBeLessThan(sorted.indexOf('Quality &amp; Compliance'))
    const searched = table({ divisions: ['q', 'c'], query: 'operations' })
    expect(searched).toContain('>Clinical Operations</span>')
    expect(searched).not.toContain('Quality &amp; Compliance')
    expect(table({ divisions: ['q'], query: 'operations' })).toContain('No divisions or departments match your search and filters.')
  })

  it('uses the same centred alignment for the Staff and SOPs values of divisions and departments', () => {
    const html = table({ query: 'quality' })
    const cells = html.match(/<td class="[^"]*">\d+<\/td>/g)!
    expect(cells.length).toBe(4)
    expect(new Set(cells.map((cell) => cell.match(/class="([^"]*)"/)![1]))).toEqual(new Set(['px-3 py-4 text-center tabular-nums']))
    expect(html).toMatch(/<th scope="col" class="px-3 py-4 text-center">Staff<\/th><th scope="col" class="px-3 py-4 text-center">SOPs<\/th>/)
  })

  it('shows generated abbreviations in the department badges', () => {
    const html = table({ query: 'clinical' })
    expect(html).toMatch(/aria-hidden="true"[^>]*>CO<\/span>/)
  })
})

type Element = ReactElement<Record<string, unknown>>
const flatten = (node: ReactNode): Element[] => Array.isArray(node) ? node.flatMap(flatten)
  : isValidElement<Record<string, unknown>>(node) ? [node, ...flatten(node.props.children as ReactNode)] : []

describe('the selected divisions', () => {
  const options = [{ value: 'c', label: 'Clinical Research & Development' }, { value: 'q', label: 'Quality & Compliance' }]

  it('are listed by name, each removable, with Clear Filters', () => {
    const onChange = vi.fn()
    const nodes = flatten(ActiveFilters({ options, selected: ['q', 'c'], onChange }))
    const remove = nodes.filter((node) => String(node.props['aria-label'] ?? '').startsWith('Remove '))
    expect(remove.map((node) => node.props['aria-label'])).toEqual([
      'Remove Clinical Research & Development from the filter', 'Remove Quality & Compliance from the filter',
    ])
    ;(remove[0].props.onClick as () => void)()
    expect(onChange).toHaveBeenLastCalledWith(['q'])
    const clear = nodes.find((node) => node.props.children === 'Clear Filters')!
    ;(clear.props.onClick as () => void)()
    expect(onChange).toHaveBeenLastCalledWith([])
  })
})

describe('names in the table', () => {
  it('shows division and department names as plain text: no links and no underline', () => {
    const html = table({ query: 'quality' })
    // Division name: inside the expand toggle, which still toggles (aria-expanded).
    expect(html).toMatch(/<button type="button" aria-expanded="true"[\s\S]*?<span class="block font-semibold text-maroon">Quality &amp; Compliance<\/span>/)
    // Department name: plain text, no longer a link to its page.
    expect(html).toMatch(/<span class="min-w-0 break-words">Quality Assurance<\/span>/)
    expect(html).not.toContain('href="/admin/departments/qa"')
    expect(html).not.toContain('underline')
    expect(html).toMatch(/<span class="mt-1 block text-xs font-normal text-text-gray">Departments \((?:<!-- -->)?1(?:<!-- -->)?\)<\/span>/)
    expect(html).not.toMatch(/<tr[^>]*underline/)
    expect(html).not.toMatch(/<span class="[^"]*underline[^"]*">Departments/)
  })
})

describe('department row actions', () => {
  it('has a Preview eye button before Edit and Delete, like the division row', () => {
    const html = table({ query: 'quality' })
    const row = html.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*?Quality Assurance[\s\S]*?<\/tr>/)![0]
    expect([...row.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1])).toEqual([
      'Preview Quality Assurance', 'Edit Quality Assurance', 'Delete Quality Assurance',
    ])
  })
  it('shows "Preview {name}" as the tooltip of both eye buttons, the same as the accessible name', () => {
    const html = table({ query: 'quality' })
    for (const name of ['Quality &amp; Compliance', 'Quality Assurance']) {
      // The tooltip that follows this button.
      const after = html.slice(html.indexOf(`aria-label="Preview ${name}"`))
      expect(after.match(/role="tooltip"[^>]*><span[^>]*>([^<]*)</)![1]).toBe(`Preview ${name}`)
    }
  })
  /** The Delete button of the department named `name`, and the text of the tooltip it is described by. */
  const deleteButton = (html: string, name: string) => {
    const button = html.match(new RegExp(`<button[^>]*aria-label="Delete ${name}"[^>]*>`))![0]
    const described = button.match(/aria-describedby="([^"]+)"/)?.[1]
    const reason = described && html.match(new RegExp(`id="${described}"[^>]*><span[^>]*>([^<]*)<`))?.[1]
    return { disabled: button.includes('aria-disabled="true"'), reason }
  }
  it('disables Delete for a department with SOPs, with the reason for keyboard and screen-reader users', () => {
    const sopsOnly = { ...snapshot, departments: snapshot.departments.map((row) => row.id === 'qa' ? { ...row, employees: 0 } : row) }
    expect(deleteButton(table({ snapshot: sopsOnly, query: 'quality' }), 'Quality Assurance'))
      .toEqual({ disabled: true, reason: 'This department can’t be deleted because it has SOPs.' })
  })
  it('gives only the employees reason when a department has both employees and SOPs', () => {
    expect(deleteButton(table({ query: 'quality' }), 'Quality Assurance')).toEqual({ disabled: true,
      reason: 'This department can’t be deleted because it has employees.' })
  })
  it('keeps the employees reason, and enables Delete for an empty department', () => {
    const employeesOnly = { ...snapshot, departments: snapshot.departments.map((row) => row.id === 'qa' ? { ...row, sops: 0 } : row) }
    expect(deleteButton(table({ snapshot: employeesOnly, query: 'quality' }), 'Quality Assurance'))
      .toEqual({ disabled: true, reason: 'This department can’t be deleted because it has employees.' })
    expect(deleteButton(table({ query: 'legacy' }), 'Legacy')).toEqual({ disabled: false, reason: undefined })
  })
  it('never blocks Retry file cleanup for a deletion confirmed earlier', () => {
    const pending = { ...snapshot, departments: snapshot.departments.map((row) => row.id === 'qa' ? { ...row, employees: 0, sops: 0, deletion_job_id: 'job' } : row) }
    const html = table({ snapshot: pending, query: 'quality' })
    const button = html.match(/<button[^>]*aria-label="Retry file cleanup Quality Assurance"[^>]*>/)![0]
    expect(button).not.toContain('aria-disabled="true"')
  })
})
