import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { filtersEn } from '../../content/filters.en'
import { departmentsKept, filterSelection, type FilterDepartments } from '../../lib/organization'
import { FilterPopover, type FilterSection } from './FilterPopover'
import { filterSummary } from './filterSummary'

const division = (value: string[]): FilterSection => ({
  id: 'division', legend: filtersEn.division.legend, options: [{ value: 'med', label: 'Medical' }, { value: 'ops', label: 'Operations' }],
  value, onChange: vi.fn(), emptyText: filtersEn.division.empty, summary: filtersEn.division.count,
})
const department = (value: string[]): FilterSection => ({
  id: 'department', legend: filtersEn.department.legend, groups: [{ id: 'med', label: 'Medical', options: [{ value: 'pv', label: 'Pharmacovigilance' }] }],
  value, onChange: vi.fn(), emptyText: filtersEn.department.empty, summary: filtersEn.department.count,
})
const render = (sections: FilterSection[]) => renderToStaticMarkup(
  <FilterPopover label={filtersEn.label} allLabel={filtersEn.all} title={filtersEn.title} clearLabel={filtersEn.clearAll} sections={sections} />,
)

describe('the Filter field of every list page', () => {
  it('looks like the other dropdowns: the "Filter" label, "All" in grey and a chevron, closed', () => {
    const html = render([division([]), department([])])
    expect(html).toMatch(/<label for="([^"]+)" class="mb-1\.5 block text-sm font-medium text-maroon">Filter<\/label><button id="\1" type="button" aria-label="Filter" aria-expanded="false" aria-controls="[^"]+"/)
    expect(html).toContain('min-h-11')
    expect(html).toContain('<span class="truncate text-text-gray">All</span>')
    expect(html).toContain('lucide-chevron-down')
    expect(html).not.toContain('lucide-funnel')
    // The panel: "Filters", Clear all (nothing to clear yet), and the sections.
    expect(html).toMatch(/hidden="" role="group" aria-labelledby="[^"]+"/)
    expect(html).toContain('>Filters</h2>')
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>Clear all<\/button>/)
    expect([...html.matchAll(/<legend[^>]*>([^<]+)<\/legend>/g)].map((match) => match[1])).toEqual(['Division', 'Department'])
  })

  it('sums up the choices in the field and its accessible name', () => {
    const html = render([division(['med', 'ops']), department(['pv'])])
    expect(html).toContain('aria-label="Filter: 2 divisions, 1 department"')
    expect(html).toContain('<span class="truncate ">2 divisions, 1 department</span>')
    expect(filterSummary([division(['med']), department([])])).toBe('1 division')
    expect(filterSummary([division([]), department([])])).toBe('')
  })

  it('shows only the sections a page has', () => {
    const html = render([division([])])
    expect([...html.matchAll(/<legend[^>]*>([^<]+)<\/legend>/g)].map((match) => match[1])).toEqual(['Division'])
  })
})

describe('the linked Division and Department filter (shared by every list page)', () => {
  const data: FilterDepartments = {
    divisions: [{ id: 'ops', name: 'Operations' }, { id: 'med', name: 'Medical' }],
    departments: [{ id: 'pv', name: 'Pharmacovigilance', divisionId: 'med' }, { id: 'qa', name: 'Quality', divisionId: 'ops' }, { id: 'it', name: 'IT' }],
  }

  it('offers the divisions A to Z and drops choices no longer offered', () => {
    const selection = filterSelection(data, ['med', 'gone'], ['pv', 'qa', 'it'])
    expect(selection.divisionChoices.map((option) => option.label)).toEqual(['Medical', 'Operations'])
    expect(selection.divisions).toEqual(['med'])
    // With Medical selected, only its departments are offered.
    expect(selection.groups.map((group) => group.id)).toEqual(['med'])
    expect(selection.departments).toEqual(['pv'])
  })

  it('drops the departments of a division that is deselected', () => {
    expect(departmentsKept(data, ['med'], ['pv', 'qa'])).toEqual(['pv'])
    expect(departmentsKept(data, [], ['pv', 'qa', 'it'])).toEqual(['pv', 'qa', 'it'])
  })
})
