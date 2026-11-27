import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import type { ManagementSnapshot } from '../../services/organizationAdmin'
import { DuplicateNameError } from '../../lib/duplicateNameError'
import { DepartmentFormPage } from './DepartmentFormPage'

// Hooks as plain storage, so the page can be called as a function and its submit handler run without a browser
// (as in components/admin/departmentDialog.test.tsx).
const host = vi.hoisted(() => ({
  states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0,
  params: {} as Record<string, string>, save: vi.fn(), navigate: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = host.index++
    if (!(index in host.states)) host.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
    return [host.states[index], (value: unknown) => {
      host.states[index] = typeof value === 'function' ? (value as (previous: unknown) => unknown)(host.states[index]) : value
    }]
  },
  useRef: (initial: unknown) => {
    const index = host.refIndex++
    if (!(index in host.refs)) host.refs[index] = { current: initial }
    return host.refs[index]
  },
}))
vi.mock('react-router-dom', async (original) => ({
  ...await original<typeof import('react-router-dom')>(),
  useParams: () => host.params,
  useNavigate: () => host.navigate,
  useSearchParams: () => [new URLSearchParams()],
}))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../hooks/useOrganizationManagement', () => ({ useOrganizationManagement: () => ({ data: snapshot, refresh: vi.fn() }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ reload: vi.fn() }) }))
vi.mock('../../services/organizationAdmin', () => ({ saveDepartment: host.save }))

const snapshot: ManagementSnapshot = {
  divisions: [{ id: 'medical', name: 'Medical Division', description: '', email: null, updated_at: 'v1' }],
  departments: [
    { id: 'home', name: 'Home', initials: 'HM', description: 'Our work', email: 'home@hawkim.test', division_id: 'medical', updated_at: 'r1', people: [], employees: 0, sops: 0, status_counts: {} },
  ],
}

type Element = ReactElement<Record<string, unknown>>
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
/** The page, then the form it returns (a component of its own), rendered as plain function calls. */
function render(): Element[] {
  host.index = 0; host.refIndex = 0
  const form = DepartmentFormPage() as Element
  return elements((form.type as (props: unknown) => ReactNode)(form.props))
}
const field = (name: string) => render().find((item) => item.props.name === name)!
const change = (name: string, value: string) => (field(name).props.onChange as (event: unknown) => void)({ target: { value } })
const submit = () => (render().find((item) => item.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: () => {} })

beforeEach(() => {
  host.states = []; host.refs = []; host.index = 0; host.refIndex = 0
  vi.clearAllMocks()
  host.save.mockRejectedValue(new DuplicateNameError('department'))
})

describe('the Add/Edit Department page: a name the server finds already used', () => {
  it.each([['Add Department', {}], ['Edit Department', { id: 'home' }]])('%s: shows it under Name only and moves focus there', async (_, params) => {
    host.params = params
    change('division', 'medical')
    change('name', 'Clinical Operations')
    change('description', 'Runs the trials')
    change('email', 'clinops@hawkim.test')
    render()
    // The refs in the page's order: division, name, description, email, save error.
    const focus = host.refs.map((ref) => { const spy = vi.fn(); ref.current = { focus: spy }; return spy })
    await submit()
    expect(host.save).toHaveBeenCalledOnce()
    expect(field('name').props.error).toBe('A department with this name already exists. Please choose a different name.')
    expect(focus[1]).toHaveBeenCalled()
    expect(focus[4]).not.toHaveBeenCalled()
    // No form-level refusal, and the page stays open.
    expect(render().some((item) => typeof item.props.children === 'string' && item.props.children.includes('already exists') && item.props.name === undefined)).toBe(false)
    expect(host.navigate).not.toHaveBeenCalled()
  })
})
