import { beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { EmployeePositionsDialog } from './EmployeePositionsDialog'
const host = vi.hoisted(() => ({ states: [] as unknown[], index: 0, save: vi.fn() }))
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useState: (initial: unknown) => {
  const index = host.index++
  if (!(index in host.states)) host.states[index] = initial
  return [host.states[index], (value: unknown) => { host.states[index] = value }]
} }))
vi.mock('../../services/organizationAdmin', () => ({ setEmployeePositions: host.save }))
type Element = ReactElement<Record<string, unknown>>
const elements = (node: ReactNode): Element[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<Record<string, unknown>>(node) ? [node, ...elements(node.props.children as ReactNode)] : []
const person = { id: 'p', name: 'Sara', email: 's@test.invalid', initials: 'SA', departmentId: 'd', permissions: [], positions: ['Safety Officer', 'QPPV Deputy'] }
const render = (props = {}) => { host.index = 0; return EmployeePositionsDialog({ person, onClose: vi.fn(), onSaved: vi.fn(), ...props }) }
beforeEach(() => { host.states = []; vi.clearAllMocks(); host.save.mockResolvedValue(undefined) })

it('prefills every position and saves them all', async () => {
  const onSaved = vi.fn()
  const dialog = render({ onSaved })
  expect(elements(dialog).filter((node) => String(node.props.name).startsWith('position-')).map((node) => node.props.value)).toEqual(['Safety Officer', 'QPPV Deputy'])
  await (dialog.props.onConfirm as () => Promise<unknown>)()
  expect(host.save).toHaveBeenCalledWith('p', ['Safety Officer', 'QPPV Deputy'])
  expect(onSaved).toHaveBeenCalledOnce()
})
it('requires at least one position before calling the server', async () => {
  host.states = [['  '], false, '']
  const dialog = render()
  await expect((dialog.props.onConfirm as () => Promise<unknown>)()).resolves.toBe(false)
  expect(host.save).not.toHaveBeenCalled()
})
it('keeps the dialog open and shows a server refusal', async () => {
  host.save.mockRejectedValue(new Error('Only an active Admin can manage divisions and departments.'))
  await expect((render().props.onConfirm as () => Promise<unknown>)()).resolves.toBe(false)
  expect(elements(render()).some((node) => node.props.role === 'alert')).toBe(true)
})
