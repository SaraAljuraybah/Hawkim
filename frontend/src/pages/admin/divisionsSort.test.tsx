import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import type { ManagementSnapshot } from '../../services/organizationAdmin'
import { AdminDepartmentsPage, HierarchyTable } from './AdminDepartmentsPage'
import { SelectField } from '../../components/ui/SelectField'

// The page is called as a function with stand-in hooks, so the Sort field's change handler can be driven without a DOM.
const host = vi.hoisted(() => ({ states: [] as unknown[], index: 0 }))
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useState: (initial: unknown) => {
  const index = host.index++
  if (!(index in host.states)) host.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
  return [host.states[index], (value: unknown) => { host.states[index] = value }]
}, useRef: (initial: unknown) => ({ current: initial }), useMemo: (make: () => unknown) => make() }))
vi.mock('react-router-dom', async (original) => ({ ...await original<typeof import('react-router-dom')>(), useLocation: () => ({ state: null }) }))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
const snapshot: ManagementSnapshot = {
  divisions: [{ id: 'q', name: 'Quality and Compliance', description: '', email: null, updated_at: null, department_count: 0, employees: 3, sops: 2 }],
  departments: [],
}
vi.mock('../../hooks/useOrganizationManagement', () => ({ useOrganizationManagement: () => ({ data: snapshot, refresh: vi.fn() }) }))
beforeEach(() => { host.states = []; host.index = 0 })

type Element = ReactElement<Record<string, unknown>>
const elements = (node: ReactNode): Element[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement<Record<string, unknown>>(node) ? [node, ...elements(node.props.children as ReactNode)] : []
const render = () => { host.index = 0; return elements(AdminDepartmentsPage() as ReactNode) }

describe('the Sort field on Divisions and Departments', () => {
  it('starts on Default order and orders the table by the option chosen, as Sort does on the other list pages', () => {
    const sortField = () => render().find((item) => item.type === SelectField && item.props.name === 'divisionSort')!
    const tableSort = () => render().find((item) => item.type === HierarchyTable)!.props.sort
    expect(sortField().props.value).toBe('default')
    expect(tableSort()).toBe('default')
    for (const value of ['division-desc', 'department-desc', 'sops-desc', 'staff-asc', 'default']) {
      ;(sortField().props.onChange as (event: unknown) => void)({ target: { value } })
      expect(sortField().props.value).toBe(value)
      expect(tableSort()).toBe(value)
    }
  })
})
