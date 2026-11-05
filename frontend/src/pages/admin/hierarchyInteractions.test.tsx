import { beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { HierarchyTable } from './AdminDepartmentsPage'
const state = vi.hoisted(() => ({ value: new Set<string>() }))
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useState: () => [state.value, (next: (previous: Set<string>) => Set<string>) => { state.value = next(state.value) }] }))
type Element = ReactElement<Record<string, unknown>>
const flatten = (node: ReactNode): Element[] => Array.isArray(node) ? node.flatMap(flatten) : isValidElement<Record<string, unknown>>(node) ? [node,...flatten(node.props.children as ReactNode)] : []
const props = {
  snapshot: { divisions: [{ id:'v', name:'Safety',email:null,description:'',updated_at:null }], departments: [{ id:'d',name:'Medical',initials:'MD',description:'',division_id:'v',updated_at:'revision',employees:0,sops:1,status_counts:{} }] },
  onPreview:vi.fn(),onEdit:vi.fn(),onDeleteDivision:vi.fn(),onDeleteDepartment:vi.fn(),
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
  expect(nodes.some((node) => node.props.to === '/admin/departments/new?division=v')).toBe(true)
  expect(totals()).toEqual([0,1,0,1])
  ;(chevron().props.onClick as () => void)()
  nodes = render()
  expect(chevron().props['aria-expanded']).toBe(false)
  expect(totals()).toEqual([0,1])
})
it('dispatches preview/edit/delete to the selected record', () => {
  const nodes = flatten(HierarchyTable({ ...props,query:'safety' }))
  for (const [label, callback] of [['Preview Safety',props.onPreview],['Edit Safety',props.onEdit],['Delete Medical',props.onDeleteDepartment]] as const) {
    const action = nodes.find((node) => node.props.label === label)!
    ;(action.props.onClick as () => void)()
    expect(callback).toHaveBeenCalledOnce()
  }
})
