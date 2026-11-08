import { beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { HierarchyTable } from './AdminDepartmentsPage'
const state = vi.hoisted(() => ({ value: new Set<string>() }))

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => [
    state.value,
    (next: (previous: Set<string>) => Set<string>) => {
      state.value = next(state.value)
    },
  ],
}))

vi.mock('react-router-dom', async (original) => ({
  ...await original<typeof import('react-router-dom')>(),
  useNavigate: () => () => {},
}))

type Element = ReactElement<Record<string, unknown>>
/** The "Add Department" button of an expanded division. */
const isAdd = (node: Element) => Array.isArray(node.props.children) && (node.props.children as unknown[]).includes('Add Department')
const flatten = (node: ReactNode): Element[] => Array.isArray(node) ? node.flatMap(flatten) : isValidElement<Record<string, unknown>>(node) ? [node,...flatten(node.props.children as ReactNode)] : []
const props = {
  snapshot: { divisions: [{ id:'v', name:'Safety',email:null,description:'',updated_at:null }], departments: [{ id:'d',name:'Medical',initials:'MD',description:'',division_id:'v',updated_at:'revision',employees:0,sops:1,status_counts:{} }] },
  onPreview:vi.fn(),onViewDepartment:vi.fn(),onAddDepartment:vi.fn(),onEditDepartment:vi.fn(),onEdit:vi.fn(),onDeleteDivision:vi.fn(),onDeleteDepartment:vi.fn(),
}
beforeEach(() => { state.value = new Set(); vi.clearAllMocks() })
it('expands and collapses using the chevron while leaving aggregate values unchanged', () => {
  const render = () => flatten(HierarchyTable(props))
  let nodes = render()
  const chevron = () => nodes.find((node) => node.type === 'button' && 'aria-expanded' in node.props)!
  expect(chevron().props['aria-expanded']).toBe(false)
  expect(nodes.some((node) => node.props.children === 'Add Department')).toBe(false)
  const totals = () => nodes.filter((node) => node.type === 'td' && typeof node.props.children === 'number').map((node) => node.props.children)
  expect(totals()).toEqual([0,1])
  ;(chevron().props.onClick as () => void)()
  nodes = render()
  expect(chevron().props['aria-expanded']).toBe(true)
  // Add Department opens the dialog for this division (no page link).
  const add = nodes.find(isAdd)!
  expect(add.props.to).toBeUndefined()
  ;(add.props.onClick as () => void)()
  expect(props.onAddDepartment).toHaveBeenCalledWith('v')
  expect(totals()).toEqual([0,1,0,1])
  ;(chevron().props.onClick as () => void)()
  nodes = render()
  expect(chevron().props['aria-expanded']).toBe(false)
  expect(totals()).toEqual([0,1])
})
it('dispatches preview/view/edit/delete to the selected record', () => {
  const nodes = flatten(HierarchyTable({ ...props,query:'safety' }))
  for (const [label, callback] of [['Preview Safety',props.onPreview],['Edit Safety',props.onEdit],['Preview Medical',props.onViewDepartment],['Edit Medical',props.onEditDepartment],['Delete Medical',props.onDeleteDepartment]] as const) {
    const action = nodes.find((node) => node.props.label === label)!
    ;(action.props.onClick as () => void)()
    expect(callback).toHaveBeenCalledOnce()
  }
})
it('toggles from the division name (one control with the chevron) and shows the count only under the name', () => {
  const render = () => flatten(HierarchyTable(props))
  let nodes = render()
  const toggle = () => nodes.find((node) => node.type === 'button' && 'aria-expanded' in node.props)!
  expect(flatten(toggle().props.children as ReactNode).some((node) => node.props.children === 'Safety')).toBe(true)
  ;(toggle().props.onClick as () => void)()
  nodes = render()
  // The inner toolbar has no "Departments" label; the count stays under the name.
  expect(nodes.some((node) => node.props.children === 'Departments')).toBe(false)
  expect(flatten(toggle().props.children as ReactNode).some((node) => Array.isArray(node.props.children) && node.props.children.join('') === 'Departments (1)')).toBe(true)
  // A compact (small) primary button that keeps its plus icon and text.
  const add = nodes.find(isAdd)!
  expect(add.props.size).toBe('sm')
  expect(add.props.variant).toBeUndefined()
  expect(flatten(add.props.children as ReactNode).some((node) => String(node.props.className).includes('size-3.5'))).toBe(true)
  expect((add.props.children as ReactNode[]).includes('Add Department')).toBe(true)
})
it('opens matching divisions while searching, and still lets them collapse', () => {
  const render = () => flatten(HierarchyTable({ ...props, query: 'medical' }))
  let nodes = render()
  const toggle = () => nodes.find((node) => node.type === 'button' && 'aria-expanded' in node.props)!
  expect(toggle().props['aria-expanded']).toBe(true)
  ;(toggle().props.onClick as () => void)()
  nodes = render()
  expect(toggle().props['aria-expanded']).toBe(false)
  expect(nodes.some(isAdd)).toBe(false)
})
it('uses the server division totals rather than only the rendered rows', () => {
  const snapshot = { ...props.snapshot, divisions: [{ ...props.snapshot.divisions[0], department_count: 1, employees: 4, sops: 9 }] }
  const nodes = flatten(HierarchyTable({ ...props, snapshot }))
  expect(nodes.filter((node) => node.type === 'td' && typeof node.props.children === 'number').map((node) => node.props.children)).toEqual([4, 9])
})
it('keeps the division filter while expanding and collapsing', () => {
  const snapshot = { ...props.snapshot, divisions: [...props.snapshot.divisions, { id: 'w', name: 'Other', email: null, description: '', updated_at: null }] }
  const render = () => flatten(HierarchyTable({ ...props, snapshot, divisions: ['v'] }))
  const shownDivisions = (nodes: ReturnType<typeof render>) => nodes.filter((node) => node.type === 'button' && 'aria-expanded' in node.props).length
  let nodes = render()
  expect(shownDivisions(nodes)).toBe(1)
  const toggle = () => nodes.find((node) => node.type === 'button' && 'aria-expanded' in node.props)!
  ;(toggle().props.onClick as () => void)()
  nodes = render()
  expect(toggle().props['aria-expanded']).toBe(true)
  expect(shownDivisions(nodes)).toBe(1)
  expect(nodes.some((node) => node.props.children === 'Other')).toBe(false)
  ;(toggle().props.onClick as () => void)()
  nodes = render()
  expect(toggle().props['aria-expanded']).toBe(false)
  expect(shownDivisions(nodes)).toBe(1)
})
