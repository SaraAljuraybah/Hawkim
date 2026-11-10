import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { clearFilterSections, type FilterSection } from '../components/ui/FilterPopover'
import type { Department, Sop, User } from '../data/mock/types'
import { AdminSopsPage } from './SopsPage'

/*
 * "Clear all" and "Clear Filters" on the admin SOP Directory, with the URL updated the way React
 * Router does it: every setSearchParams update starts from the URL of the last render (not from an
 * earlier update in the same click), and the last one wins. Clearing divisions and departments with
 * two updates therefore kept the divisions; one update clears both.
 */
const fixture = vi.hoisted(() => ({
  user: { id: 'admin', name: 'Nouf', initials: 'NA', email: 'nouf@example.test', departmentId: 'it', permissions: ['admin'] } as User,
  departments: [
    { id: 'it', name: 'Information Technology', initials: 'IT', description: '' },
    { id: 'pv', name: 'Pharmacovigilance', initials: 'PV', description: '', divisionId: 'med', divisionName: 'Medical' },
    { id: 'qa', name: 'Quality Assurance', initials: 'QA', description: '', divisionId: 'med', divisionName: 'Medical' },
  ] as Department[],
  sops: [] as Sop[],
  /** The URL of the last render. */
  rendered: new URLSearchParams(),
  /** Each URL update in turn. */
  updates: [] as URLSearchParams[],
  popover: undefined as undefined | { sections: FilterSection[]; onClear?: () => void },
  clearFilters: undefined as undefined | (() => void),
}))
vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useSearchParams: () => [fixture.rendered, (next: URLSearchParams | ((current: URLSearchParams) => URLSearchParams)) => {
    fixture.updates.push(typeof next === 'function' ? next(fixture.rendered) : next)
  }],
}))
vi.mock('../components/ui/FilterPopover', async (original) => ({
  ...(await original<typeof import('../components/ui/FilterPopover')>()),
  FilterPopover: (props: { sections: FilterSection[]; onClear?: () => void }) => { fixture.popover = props; return null },
}))
vi.mock('../components/ui/Button', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => {
    if (children === 'Clear Filters') fixture.clearFilters = onClick
    return <button type="button">{children}</button>
  },
}))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.user }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({
  departments: fixture.departments,
  getDepartment: (id: string) => fixture.departments.find((item) => item.id === id),
  nameOf: (id: string) => fixture.departments.find((item) => item.id === id)?.name ?? '',
}) }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: fixture.sops }) }))

const sop = (id: string, departmentId: string): Sop => ({
  id, code: `SOP-${id}`, title: `Procedure ${id}`, authorId: 'someone', coAuthorIds: [], departmentId, status: 'published', version: '1',
  lastUpdated: '2026-10-01', fileName: 'a.pdf', fileType: 'pdf', versions: [], reviewers: [], approvers: [], timeline: [], comments: [], complianceChecks: [],
})
function open(search: string) {
  fixture.rendered = new URLSearchParams(search)
  fixture.updates = []
  fixture.popover = undefined
  fixture.clearFilters = undefined
  return renderToStaticMarkup(<MemoryRouter><AdminSopsPage /></MemoryRouter>)
}
/** The URL after the updates of one click (the last one wins). */
const finalUrl = () => fixture.updates.at(-1)?.toString()

beforeEach(() => {
  fixture.sops = [sop('1', 'it'), sop('2', 'pv'), sop('3', 'qa')]
})

describe('Clear all in the admin SOP Directory\'s Filter panel', () => {
  it('clears both the divisions and the departments in one URL update, keeping the search and sort', () => {
    open('q=procedure&sort=oldest&division=med&dept=pv&page=2')
    clearFilterSections(fixture.popover!.sections, fixture.popover!.onClear)
    expect(fixture.updates).toHaveLength(1)
    expect(finalUrl()).toBe('q=procedure&sort=oldest')
  })

  it('also clears when only divisions or only departments are selected', () => {
    open('division=med')
    clearFilterSections(fixture.popover!.sections, fixture.popover!.onClear)
    expect(finalUrl()).toBe('')
    open('dept=pv,qa')
    clearFilterSections(fixture.popover!.sections, fixture.popover!.onClear)
    expect(finalUrl()).toBe('')
  })
})

describe('Clear Filters in the admin SOP Directory', () => {
  it.each([
    ['the search only', 'q=m'],
    ['a division only', 'division=med'],
    ['a department only', 'dept=pv'],
    ['a sort other than the default only', 'sort=oldest'],
  ])('shows for %s', (_name, search) => {
    expect(open(search)).toContain('>Clear Filters<')
  })

  it('is hidden when nothing differs from the default, or only the tab does', () => {
    expect(open('')).not.toContain('>Clear Filters<')
    expect(open('tab=recent')).not.toContain('>Clear Filters<')
  })

  it('resets the search, divisions, departments and sort in one URL update, back to page 1, keeping the tab', () => {
    open('tab=recent&q=m&sort=oldest&division=med&dept=pv&page=2')
    fixture.clearFilters!()
    expect(fixture.updates).toHaveLength(1)
    expect(finalUrl()).toBe('tab=recent')
  })
})

describe('Clear all without onClear (Organizational Structure, plain state)', () => {
  it('empties every section in turn', () => {
    const onChange = [vi.fn(), vi.fn(), vi.fn()]
    clearFilterSections(onChange.map((change, index) => ({ id: String(index), legend: '', value: ['x'], onChange: change, emptyText: '', summary: { one: '', other: '' } })))
    for (const change of onChange) expect(change).toHaveBeenCalledWith([])
  })
  it('calls onClear once instead, when given', () => {
    const onChange = vi.fn()
    const onClear = vi.fn()
    clearFilterSections([{ id: 'a', legend: '', value: ['x'], onChange, emptyText: '', summary: { one: '', other: '' } }], onClear)
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })
})
