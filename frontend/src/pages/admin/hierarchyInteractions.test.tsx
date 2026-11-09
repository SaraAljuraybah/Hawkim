import { beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react'
import { HierarchyTable } from './AdminDepartmentsPage'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
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
/** The Add Department icon button of a division row. */
const isAdd = (node: Element) => node.props.label === 'Add Department'
const flatten = (node: ReactNode): Element[] => Array.isArray(node) ? node.flatMap(flatten) : isValidElement<Record<string, unknown>>(node) ? [node,...flatten(node.props.children as ReactNode)] : []
/** The action cells, one per rendered division or department row, in table order. */
const actionCells = (nodes: Element[]) => nodes.filter((node) => node.type === 'td' && node.props.className === 'p-3')
/** A cell's icon buttons, in order. */
const actions = (cell: Element) => flatten(cell.props.children as ReactNode).filter((node) => node.type === IconButton)
const toggles = (nodes: Element[]) => nodes.filter((node) => node.type === 'button' && 'aria-expanded' in node.props)
const props = {
  snapshot: { divisions: [{ id:'v', name:'Safety',email:null,description:'',updated_at:null }], departments: [{ id:'d',name:'Medical',initials:'MD',description:'',division_id:'v',updated_at:'revision',employees:0,sops:1,status_counts:{} }] },
  onPreview:vi.fn(),onViewDepartment:vi.fn(),onAddDepartment:vi.fn(),onEditDepartment:vi.fn(),onEdit:vi.fn(),onDeleteDivision:vi.fn(),onDeleteDepartment:vi.fn(),
}
/** Safety (v) then Quality (w), in the default (snapshot) order. */
const twoDivisions = { ...props.snapshot, divisions: [...props.snapshot.divisions, { id: 'w', name: 'Quality', email: null, description: '', updated_at: null }] }
beforeEach(() => { state.value = new Set(); vi.clearAllMocks() })
it('expands and collapses using the chevron while leaving aggregate values unchanged', () => {
  const render = () => flatten(HierarchyTable(props))
  let nodes = render()
  const chevron = () => toggles(nodes)[0]
  expect(chevron().props['aria-expanded']).toBe(false)
  const totals = () => nodes.filter((node) => node.type === 'td' && typeof node.props.children === 'number').map((node) => node.props.children)
  expect(totals()).toEqual([0,1])
  ;(chevron().props.onClick as () => void)()
  nodes = render()
  expect(chevron().props['aria-expanded']).toBe(true)
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
it('gives every division row Add Department, Preview, Edit, Delete in that order, as matching icon buttons', () => {
  const nodes = flatten(HierarchyTable({ ...props, snapshot: twoDivisions }))
  // Collapsed: only the two division rows have actions.
  expect(actionCells(nodes)).toHaveLength(2)
  for (const [index, name] of [[0, 'Safety'], [1, 'Quality']] as const) {
    const buttons = actions(actionCells(nodes)[index])
    expect(buttons.map((node) => node.props.label)).toEqual(['Add Department', `Preview ${name}`, `Edit ${name}`, `Delete ${name}`])
    expect(buttons.map((node) => node.props.icon)).toEqual([Plus, Eye, Pencil, Trash2])
    // Icon only: the label is its accessible name and its hover/focus tooltip; boxed like its neighbours.
    const add = buttons[0]
    expect(add.props.children).toBeUndefined()
    expect(add.props.tooltip).toBeUndefined()
    expect(add.props.danger).toBeUndefined()
    expect(add.props.bare).toBeUndefined()
  }
})
it('presets Add Department to the clicked division, collapsed or expanded', () => {
  const render = () => flatten(HierarchyTable({ ...props, snapshot: twoDivisions }))
  let nodes = render()
  const addOf = (index: number) => actions(actionCells(nodes)[index]).find(isAdd)!
  ;(addOf(1).props.onClick as () => void)()
  expect(props.onAddDepartment).toHaveBeenLastCalledWith('w')
  ;(addOf(0).props.onClick as () => void)()
  expect(props.onAddDepartment).toHaveBeenLastCalledWith('v')
  // Expand Safety: its button still targets Safety (and Quality's, Quality), and no other Add Department appears.
  ;(toggles(nodes)[0].props.onClick as () => void)()
  nodes = render()
  expect(toggles(nodes)[0].props['aria-expanded']).toBe(true)
  expect(nodes.filter(isAdd)).toHaveLength(2)
  // Rows: Safety, Medical, Quality.
  expect(actions(actionCells(nodes)[1]).some(isAdd)).toBe(false)
  ;(addOf(0).props.onClick as () => void)()
  expect(props.onAddDepartment).toHaveBeenLastCalledWith('v')
  ;(addOf(2).props.onClick as () => void)()
  expect(props.onAddDepartment).toHaveBeenLastCalledWith('w')
  expect(props.onAddDepartment).toHaveBeenCalledTimes(4)
})
it('does not give department rows an Add Department action', () => {
  const nodes = flatten(HierarchyTable({ ...props, query: 'medical' }))
  const cells = actionCells(nodes)
  expect(cells).toHaveLength(2)
  expect(actions(cells[1]).map((node) => node.props.label)).toEqual(['Preview Medical', 'Edit Medical', 'Delete Medical'])
})
it('toggles from the division name (one control with the chevron) and shows the count only under the name', () => {
  const render = () => flatten(HierarchyTable(props))
  let nodes = render()
  const toggle = () => toggles(nodes)[0]
  expect(flatten(toggle().props.children as ReactNode).some((node) => node.props.children === 'Safety')).toBe(true)
  ;(toggle().props.onClick as () => void)()
  nodes = render()
  expect(nodes.some((node) => node.props.children === 'Departments')).toBe(false)
  expect(flatten(toggle().props.children as ReactNode).some((node) => Array.isArray(node.props.children) && node.props.children.join('') === 'Departments (1)')).toBe(true)
  // No toolbar: no text button, and the department rows are the only rows of the toggle's target group.
  expect(nodes.some((node) => node.type === Button)).toBe(false)
  expect(toggle().props['aria-controls']).toBe('children-v')
  const group = nodes.find((node) => node.props.id === 'children-v')!
  expect(group.type).toBe('tbody')
  const rows = flatten(group.props.children as ReactNode).filter((node) => node.type === 'tr')
  expect(rows).toHaveLength(1)
  expect(flatten(rows[0].props.children as ReactNode).some((node) => node.props.children === 'Medical')).toBe(true)
})
it('opens matching divisions while searching, and still lets them collapse', () => {
  const render = () => flatten(HierarchyTable({ ...props, query: 'medical' }))
  let nodes = render()
  const toggle = () => toggles(nodes)[0]
  expect(toggle().props['aria-expanded']).toBe(true)
  ;(toggle().props.onClick as () => void)()
  nodes = render()
  expect(toggle().props['aria-expanded']).toBe(false)
  // Collapsed: the department group is hidden and empty; the division keeps its Add Department.
  const group = nodes.find((node) => node.props.id === 'children-v')!
  expect(group.props.hidden).toBe(true)
  expect(flatten(group.props.children as ReactNode).filter((node) => node.type === 'tr')).toHaveLength(0)
  expect(nodes.filter(isAdd)).toHaveLength(1)
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
