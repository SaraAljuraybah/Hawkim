import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { DivisionForm, DivisionPreview } from './DivisionDialogs'
import { DeleteDepartmentDialog } from './DeleteDepartmentDialog'
const host = vi.hoisted(() => ({ states: [] as unknown[], index: 0, save: vi.fn(), remove: vi.fn() }))
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useState: (initial: unknown) => {
  const index = host.index++
  if (!(index in host.states)) host.states[index] = initial
  return [host.states[index], (value: unknown) => { host.states[index] = value }]
} }))
vi.mock('../../services/organizationAdmin', () => ({ saveDivision: host.save, deleteDepartment: host.remove }))
const division = { id: 'v', name: 'Safety', description: 'Safety work', email: 'safety@test.invalid', updated_at: 'revision' }
type Element = ReactElement<Record<string, unknown>>
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  // Also walk element-valued props, e.g. FormDialog's headerAction and TextField's endAdornment.
  const slots = Object.entries(node.props).filter(([key, value]) => key !== 'children' && isValidElement(value)).map(([, value]) => value as ReactNode)
  return [node, ...elements(node.props.children as ReactNode), ...slots.flatMap(elements)]
}
function render<T>(component: () => T): T { host.index = 0; return component() }
const confirm = (element: Element) => (element.props.onConfirm as () => Promise<boolean | void>)()
const change = (element: Element, value: string | boolean) => (element.props.onChange as (event: unknown) => void)({ target: { value, checked: value } })
beforeEach(() => { host.states = []; host.index = 0; vi.clearAllMocks(); host.save.mockResolvedValue('v'); host.remove.mockResolvedValue(undefined) })
describe('division create and edit form', () => {
  it.each(['invalid', 'a@b', 'a b@test.invalid'])('rejects a malformed email %s before saving', async (email) => {
    const component = () => DivisionForm({ division: { ...division, email }, onClose: vi.fn() })
    await expect(confirm(render(component))).resolves.toBe(false)
    expect(host.save).not.toHaveBeenCalled()
  })
  it('saves without an email: it is optional (the database applies the same rule)', async () => {
    const component = () => DivisionForm({ division: { ...division, email: '' }, onClose: vi.fn() })
    await confirm(render(component))
    expect(host.save).toHaveBeenCalledWith({ name: division.name, email: '', description: division.description }, { ...division, email: '' })
  })
  it('prefills every field and saves using the same revision for both edit entry points', async () => {
    const onSaved = vi.fn()
    const element = render(() => DivisionForm({ division, onClose: vi.fn(), onSaved }))
    const fields = elements(element)
    expect(fields.find((item) => item.props.name === 'divisionEmail')?.props.value).toBe(division.email)
    await confirm(element)
    expect(host.save).toHaveBeenCalledWith({ name: division.name, email: division.email, description: division.description }, division)
    expect(onSaved).toHaveBeenCalledOnce()
  })
  it('keeps the form open and displays save failures', async () => {
    host.save.mockRejectedValue(new Error('Conflict. Refresh.'))
    const component = () => DivisionForm({ division, onClose: vi.fn() })
    await expect(confirm(render(component))).resolves.toBe(false)
    expect(elements(render(component)).some((item) => item.props.role === 'alert' && item.props.children === 'Conflict. Refresh.')).toBe(true)
  })
})
describe('division preview', () => {
  it('copies the exact email and announces successful copying', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const component = () => DivisionPreview({ division, onEdit: vi.fn(), onClose: vi.fn() })
    const copy = elements(render(component)).find((item) => item.props.label === 'Copy email')!
    await (copy.props.onClick as () => Promise<void>)()
    expect(writeText).toHaveBeenCalledWith('safety@test.invalid')
    expect(elements(render(component)).some((item) => item.props.role === 'status' && item.props.children === 'Copied!')).toBe(true)
    vi.unstubAllGlobals()
  })
  it('reports clipboard failures and uses the provided shared edit entry point', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const onEdit = vi.fn()
    const component = () => DivisionPreview({ division, onEdit, onClose: vi.fn() })
    let element = render(component)
    await (elements(element).find((item) => item.props.label === 'Copy email')!.props.onClick as () => Promise<void>)()
    element = render(component)
    expect(elements(element).some((item) => item.props.role === 'status' && String(item.props.children).includes('Could not copy'))).toBe(true)
    const edit = elements(element).find((item) => item.props.onClick === onEdit)!
    ;(edit.props.onClick as () => void)()
    expect(onEdit).toHaveBeenCalledOnce()
    expect(element.props.title).toBe('Safety')
    expect(element.props.confirmLabel).toBe('Close')
    // Edit sits inside the dialog content; the email is a read-only field.
expect(element.props.headerAction).toBeUndefined()
expect(elements(element.props.children as ReactNode).some((item) => item.props.onClick === onEdit)).toBe(true)
    expect(elements(element).find((item) => item.props.name === 'divisionEmailPreview')?.props.readOnly).toBe(true)
    vi.unstubAllGlobals()
  })
})
describe('department SOP deletion choices', () => {
  const department = { id: 'd', name: 'Medical', sops: 2, updated_at: 'revision' }
  it('defaults to preserving SOPs and passes the explicit Others choice to the backend', async () => {
    await confirm(render(() => DeleteDepartmentDialog({ department, onClose: vi.fn(), onDeleted: vi.fn() })))
    expect(host.remove).toHaveBeenCalledWith(department, 'others')
  })
  it('requires a separate destructive confirmation before deleting SOPs', async () => {
    const component = () => DeleteDepartmentDialog({ department, onClose: vi.fn(), onDeleted: vi.fn() })
    let element = render(component)
    change(elements(element).find((item) => item.props.type === 'radio' && item.props.value === 'delete')!, 'delete')
    element = render(component)
    await expect(confirm(element)).resolves.toBe(false)
    expect(host.remove).not.toHaveBeenCalled()
    change(elements(render(component)).find((item) => item.props.type === 'checkbox')!, true)
    await confirm(render(component))
    expect(host.remove).toHaveBeenCalledWith(department, 'delete')
  })
  it('cancel changes no relationships', () => {
    const onClose = vi.fn()
    const element = render(() => DeleteDepartmentDialog({ department, onClose, onDeleted: vi.fn() }))
    ;(element.props.onClose as () => void)()
    expect(onClose).toHaveBeenCalledOnce(); expect(host.remove).not.toHaveBeenCalled()
  })
  it('uses normal confirmation for departments without SOPs', async () => {
    const empty = { ...department, sops: 0 }
    await confirm(render(() => DeleteDepartmentDialog({ department: empty, onClose: vi.fn(), onDeleted: vi.fn() })))
    expect(host.remove).toHaveBeenCalledWith(empty, 'empty')
  })
})
