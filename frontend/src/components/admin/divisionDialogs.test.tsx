import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { DivisionForm, DivisionPreview, EmailDetail } from './DivisionDialogs'
import { DeleteDepartmentDialog } from './DeleteDepartmentDialog'
import { renderToStaticMarkup } from 'react-dom/server'
import { CopyButton } from '../ui/CopyButton'
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
  it('counts the description up to 500, linked to the field and updated as it changes', () => {
    const html = renderToStaticMarkup(<DivisionForm onClose={vi.fn()} />)
    const textarea = html.match(/<textarea[^>]*name="divisionDescription"[^>]*>/)![0]
    expect(textarea).toContain('maxLength="500"')
    const counterId = html.match(/<p id="([^"]+-counter)"[^>]*>0 \/ 500<\/p>/)![1]
    expect(textarea.match(/aria-describedby="([^"]*)"/)![1].split(' ')).toContain(counterId)
    expect(html).not.toContain('aria-live')
    host.states = []
    const component = () => DivisionForm({ division, onClose: vi.fn() })
    const description = () => elements(render(component)).find((item) => item.props.name === 'divisionDescription')!
    expect(description().props.counter).toBe('11 / 500')
    change(description(), 'x'.repeat(500))
    expect(description().props.counter).toBe('500 / 500')
  })
  it('marks Name, Description and Email as required, with an asterisk', () => {
    const fields = elements(render(() => DivisionForm({ onClose: vi.fn() })))
    for (const name of ['divisionName', 'divisionDescription', 'divisionEmail']) {
      expect(fields.find((item) => item.props.name === name)?.props).toMatchObject({ required: true, requiredMark: true })
    }
  })
  it.each([
    ['name', { name: '   ' }, 'divisionName', 'Enter a name (up to 100 characters).'],
    ['description', { description: ' \n ' }, 'divisionDescription', 'Enter a description.'],
    ['email', { email: '  ' }, 'divisionEmail', 'Enter an email address.'],
    ['email (null)', { email: null }, 'divisionEmail', 'Enter an email address.'],
  ])('refuses to save with an empty or whitespace-only %s and says why', async (_, change, field, message) => {
    const component = () => DivisionForm({ division: { ...division, ...change }, onClose: vi.fn() })
    await expect(confirm(render(component))).resolves.toBe(false)
    expect(host.save).not.toHaveBeenCalled()
    expect(elements(render(component)).find((item) => item.props.name === field)?.props.error).toBe(message)
  })
  it('requires an email when editing an existing division saved without one', async () => {
    const legacy = { ...division, email: null }
    const component = () => DivisionForm({ division: legacy, onClose: vi.fn() })
    await expect(confirm(render(component))).resolves.toBe(false)
    expect(host.save).not.toHaveBeenCalled()
    change(elements(render(component)).find((item) => item.props.name === 'divisionEmail')!, 'legacy@test.invalid')
    await confirm(render(component))
    expect(host.save).toHaveBeenCalledWith({ name: division.name, email: 'legacy@test.invalid', description: division.description }, legacy)
  })
  it('says what is wrong with a malformed email', async () => {
    const component = () => DivisionForm({ division: { ...division, email: 'invalid' }, onClose: vi.fn() })
    await confirm(render(component))
    expect(elements(render(component)).find((item) => item.props.name === 'divisionEmail')?.props.error).toBe('Enter a valid email address, e.g. name@example.com (up to 254 characters).')
  })
  it('refuses to save a new division until every field is filled', async () => {
    const component = () => DivisionForm({ onClose: vi.fn() })
    await expect(confirm(render(component))).resolves.toBe(false)
    const fields = elements(render(component))
    expect(['divisionName', 'divisionDescription', 'divisionEmail'].map((name) => Boolean(fields.find((item) => item.props.name === name)?.props.error))).toEqual([true, true, true])
    expect(host.save).not.toHaveBeenCalled()
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
  const preview = (props: Partial<Parameters<typeof DivisionPreview>[0]> = {}) => render(() => DivisionPreview({ division, onEdit: vi.fn(), onClose: vi.fn(), ...props }))
  const markup = (props: Partial<Parameters<typeof DivisionPreview>[0]> = {}) => { host.index = 0; return renderToStaticMarkup(<DivisionPreview division={division} onEdit={vi.fn()} onClose={vi.fn()} {...props} />) }

  it('keeps the title, and puts Description then Email in one compact block (one gap under the title)', () => {
    const element = preview()
    expect(element.props.title).toBe('Safety')
    expect(isValidElement(element.props.children)).toBe(true)
    const html = markup()
    expect(html.match(/<dt[^>]*>([^<]*)<\/dt>/g)!.map((tag) => tag.replace(/<[^>]+>/g, ''))).toEqual(['Description', 'Email'])
    expect(html).toMatch(/>Description<\/dt><dd[^>]*>Safety work</)
    // Plain text with the copy icon beside it, not a read-only input with a large Copy button.
    expect(html).not.toContain('<input')
    expect(html).not.toMatch(/>Copy</)
  })

  it('puts a small copy icon right beside the email, copying exactly that address', () => {
    expect(elements(preview()).find((item) => item.type === EmailDetail)?.props.email).toBe('safety@test.invalid')
    const copy = elements(EmailDetail({ email: 'safety@test.invalid' })).find((item) => item.type === CopyButton)!
    expect(copy.props).toMatchObject({ text: 'safety@test.invalid', label: 'Copy email', copiedText: 'Email copied' })
    expect(String(copy.props.failedText)).toContain('Could not copy')
    expect(markup()).toMatch(/>safety@test.invalid<\/span><span class="contents"><span class="inline-flex shrink-0">(?:<span[^>]*>)?<button[^>]*aria-label="Copy email"/)
  })

  it('says No email recorded. without a copy icon when there is no email', () => {
    const element = preview({ division: { ...division, email: null } })
    expect(elements(element).find((item) => item.type === EmailDetail)?.props.email).toBeNull()
    expect(elements(EmailDetail({ email: null })).some((item) => item.type === CopyButton)).toBe(false)
    const html = markup({ division: { ...division, email: null } })
    expect(html).toMatch(/>Email<\/dt><dd[^>]*>No email recorded.</)
    expect(html).not.toContain('Copy email')
  })

  it('leaves out an empty description instead of leaving a gap', () => {
    const html = markup({ division: { ...division, description: '' } })
    expect(html).not.toContain('>Description<')
    expect(html).toContain('>Email<')
  })

  it('keeps the Edit and Close actions', () => {
    const onEdit = vi.fn()
    const onClose = vi.fn()
    const element = preview({ onEdit, onClose })
    const edit = elements(element).find((item) => item.props.onClick === onEdit)!
    ;(edit.props.onClick as () => void)()
    expect(onEdit).toHaveBeenCalledOnce()
    expect(element.props.confirmLabel).toBe('Close')
    ;(element.props.onClose as () => void)()
    expect(onClose).toHaveBeenCalledOnce()
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
