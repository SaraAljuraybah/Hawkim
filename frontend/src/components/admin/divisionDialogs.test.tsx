import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { DivisionForm, DivisionPreview, EmailDetail } from './DivisionDialogs'
import { DeleteDepartmentDialog } from './DeleteDepartmentDialog'
import { renderToStaticMarkup } from 'react-dom/server'
import { CopyButton } from '../ui/CopyButton'
import { DuplicateNameError } from '../../lib/duplicateNameError'
const host = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, save: vi.fn(), remove: vi.fn() }))
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useState: (initial: unknown) => {
  const index = host.index++
  if (!(index in host.states)) host.states[index] = initial
  return [host.states[index], (value: unknown) => { host.states[index] = value }]
}, useRef: (initial: unknown) => {
  const index = host.refIndex++
  if (!(index in host.refs)) host.refs[index] = { current: initial }
  return host.refs[index]
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
function render<T>(component: () => T): T { host.index = 0; host.refIndex = 0; return component() }
/** Stand-ins for the rendered fields, in the form's ref order: name, email, description. */
const focusable = () => host.refs.slice(0, 3).map((ref) => { const focus = vi.fn(); ref.current = { focus }; return focus })
const confirm = (element: Element) => (element.props.onConfirm as () => Promise<boolean | void>)()
const change = (element: Element, value: string | boolean) => (element.props.onChange as (event: unknown) => void)({ target: { value, checked: value } })
beforeEach(() => { host.states = []; host.index = 0; host.refs = []; host.refIndex = 0; vi.clearAllMocks(); host.save.mockResolvedValue('v'); host.remove.mockResolvedValue(undefined) })
describe('division create and edit form', () => {
  const exists = 'A division with this name already exists. Please choose a different name.'
  const others = [{ id: 'q', name: 'Quality and Compliance' }, division]
  const field = (component: () => Element, name: string) => elements(render(component)).find((item) => item.props.name === name)!
  const nameField = (component: () => Element) => field(component, 'divisionName').props
  it.each(['Quality and Compliance', 'quality and compliance', '  QUALITY AND COMPLIANCE  '])('refuses %j when another division has that name, under Name, before saving', async (name) => {
    const component = () => DivisionForm({ divisions: others, onClose: vi.fn() }) as Element
    render(component)
    change(field(component, 'divisionName'), name)
    change(field(component, 'divisionEmail'), 'q@test.invalid')
    change(field(component, 'divisionDescription'), 'Quality work')
    const [nameFocus] = focusable()
    await expect(confirm(render(component))).resolves.toBe(false)
    expect(host.save).not.toHaveBeenCalled()
    expect(nameField(component).error).toBe(exists)
    expect(nameFocus).toHaveBeenCalledOnce()
    expect(renderToStaticMarkup(render(component))).not.toContain('role="alert"')
  })
  it('lets an edited division keep its own name, or change only its case', async () => {
    const component = () => DivisionForm({ division: { ...division, name: 'SAFETY ' }, divisions: others, onClose: vi.fn() }) as Element
    await expect(confirm(render(component))).resolves.toBeUndefined()
    expect(host.save).toHaveBeenCalledOnce()
    expect(nameField(component).error).toBeUndefined()
  })
  it('shows the database refusal under Name (a division added since the list loaded), until the name changes', async () => {
    // What saveDivision throws for save_division's 23505 (services/organizationAdmin.ts).
    host.save.mockRejectedValueOnce(new DuplicateNameError('division'))
    const component = () => DivisionForm({ division, divisions: [], onClose: vi.fn() }) as Element
    render(component)
    const [nameFocus] = focusable()
    await expect(confirm(render(component))).resolves.toBe(false)
    expect(nameField(component).error).toBe(exists)
    expect(nameFocus).toHaveBeenCalledOnce()
    expect(renderToStaticMarkup(render(component))).not.toContain('role="alert"')
    change(field(component, 'divisionName'), 'Safety Two')
    expect(nameField(component).error).toBeUndefined()
  })
  it('keeps any other refusal below the fields, not under Name', async () => {
    host.save.mockRejectedValueOnce(new Error('Someone else changed this record. Refresh the page and try again.'))
    const component = () => DivisionForm({ division, divisions: others, onClose: vi.fn() }) as Element
    await expect(confirm(render(component))).resolves.toBe(false)
    expect(nameField(component).error).toBeUndefined()
    expect(renderToStaticMarkup(render(component))).toContain('role="alert" class="text-sm text-status-rejected-fg">Someone else changed this record.')
  })
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
  it('has Name, Email and Description, in that order', () => {
    const html = renderToStaticMarkup(<DivisionForm onClose={vi.fn()} />)
    expect([...html.matchAll(/<(?:input|textarea)[^>]*name="([^"]+)"/g)].map((match) => match[1])).toEqual(['divisionName', 'divisionEmail', 'divisionDescription'])
  })
  it('marks Name, Email and Description as required (asterisk and for screen readers)', () => {
    const fields = elements(render(() => DivisionForm({ onClose: vi.fn() })))
    for (const name of ['divisionName', 'divisionEmail', 'divisionDescription']) {
      expect(fields.find((item) => item.props.name === name)?.props, name).toMatchObject({ required: true, requiredMark: true })
    }
    const html = renderToStaticMarkup(<DivisionForm onClose={vi.fn()} />)
    expect(html.match(/<label[^>]*>Email(.*?)<\/label>/)![1]).toContain('>*<')
    expect(html.match(/<label[^>]*>Description(.*?)<\/label>/)![1]).toContain('>*<')
  })
  it('shows the email placeholder', () => {
    expect(elements(render(() => DivisionForm({ onClose: vi.fn() }))).find((item) => item.props.name === 'divisionEmail')?.props.placeholder).toBe('e.g. qa@example.com')
  })
  it('uses Save for Add Division and Save Changes for Edit Division, with Cancel', () => {
    expect(render(() => DivisionForm({ onClose: vi.fn() }))).toMatchObject({ props: { title: 'Add Division', confirmLabel: 'Save', cancelLabel: 'Cancel' } })
    host.states = []
    expect(render(() => DivisionForm({ division, onClose: vi.fn() }))).toMatchObject({ props: { title: 'Edit Division', confirmLabel: 'Save Changes', cancelLabel: 'Cancel' } })
  })
  it('refuses an empty or whitespace-only name, says why and focuses Name first', async () => {
    const component = () => DivisionForm({ division: { ...division, name: '   ', email: 'bad' }, onClose: vi.fn() })
    render(component)
    const [name, email] = focusable()
    await expect(confirm(render(component))).resolves.toBe(false)
    expect(host.save).not.toHaveBeenCalled()
    expect(elements(render(component)).find((item) => item.props.name === 'divisionName')?.props.error).toBe('Enter a name (up to 100 characters).')
    expect(name).toHaveBeenCalledOnce()
    expect(email).not.toHaveBeenCalled()
  })
  it('focuses Email when it is the first invalid field', async () => {
    const component = () => DivisionForm({ division: { ...division, email: 'bad', description: 'x'.repeat(501) }, onClose: vi.fn() })
    render(component)
    const [name, email, description] = focusable()
    await expect(confirm(render(component))).resolves.toBe(false)
    expect(email).toHaveBeenCalledOnce()
    expect(name).not.toHaveBeenCalled()
    expect(description).not.toHaveBeenCalled()
  })
  it('focuses Description when only it is invalid (over 500 characters)', async () => {
    const component = () => DivisionForm({ division: { ...division, description: 'x'.repeat(501) }, onClose: vi.fn() })
    render(component)
    const [, , description] = focusable()
    await expect(confirm(render(component))).resolves.toBe(false)
    expect(elements(render(component)).find((item) => item.props.name === 'divisionDescription')?.props.error).toBe('Use at most 500 characters.')
    expect(description).toHaveBeenCalledOnce()
    expect(host.save).not.toHaveBeenCalled()
  })
  it.each([['empty', '', ''], ['whitespace-only', '  ', ' \n '], ['null', null, null]])('refuses a %s email and description, says why, focuses Email and keeps what was typed', async (_, email, description) => {
    const saved = { ...division, email, description }
    const component = () => DivisionForm({ division: saved, onClose: vi.fn() })
    render(component)
    const [name, emailField, descriptionField] = focusable()
    await expect(confirm(render(component))).resolves.toBe(false)
    expect(host.save).not.toHaveBeenCalled()
    const fields = elements(render(component))
    const field = (fieldName: string) => fields.find((item) => item.props.name === fieldName)!.props
    expect(field('divisionEmail').error).toBe('Enter an email address.')
    expect(field('divisionDescription').error).toBe('Enter a description.')
    expect(emailField).toHaveBeenCalledOnce()
    expect(name).not.toHaveBeenCalled()
    expect(descriptionField).not.toHaveBeenCalled()
    // What was typed stays.
    expect([field('divisionName').value, field('divisionEmail').value, field('divisionDescription').value]).toEqual([division.name, email ?? '', description ?? ''])
  })
  it('refuses only the description when the email is valid, and focuses Description', async () => {
    const component = () => DivisionForm({ division: { ...division, description: '   ' }, onClose: vi.fn() })
    render(component)
    const [, emailField, descriptionField] = focusable()
    await expect(confirm(render(component))).resolves.toBe(false)
    const fields = elements(render(component))
    expect(fields.find((item) => item.props.name === 'divisionEmail')?.props.error).toBeUndefined()
    expect(fields.find((item) => item.props.name === 'divisionDescription')?.props.error).toBe('Enter a description.')
    expect(descriptionField).toHaveBeenCalledOnce()
    expect(emailField).not.toHaveBeenCalled()
  })
  it('says what is wrong with a malformed email', async () => {
    const component = () => DivisionForm({ division: { ...division, email: 'invalid' }, onClose: vi.fn() })
    await confirm(render(component))
    expect(elements(render(component)).find((item) => item.props.name === 'divisionEmail')?.props.error).toBe('Enter a valid email address, e.g. name@example.com (up to 254 characters).')
  })
  it('needs a name, an email and a description to add a division', async () => {
    const component = () => DivisionForm({ onClose: vi.fn() })
    await expect(confirm(render(component))).resolves.toBe(false)
    let fields = elements(render(component))
    const field = (name: string) => fields.find((item) => item.props.name === name)!
    expect(['divisionName', 'divisionEmail', 'divisionDescription'].map((name) => field(name).props.error)).toEqual([
      'Enter a name (up to 100 characters).', 'Enter an email address.', 'Enter a description.'])
    change(field('divisionName'), 'Medical Affairs')
    fields = elements(render(component))
    change(field('divisionEmail'), 'medical@test.invalid')
    fields = elements(render(component))
    change(field('divisionDescription'), 'Medical information')
    await expect(confirm(render(component))).resolves.toBeUndefined()
    expect(host.save).toHaveBeenCalledWith({ name: 'Medical Affairs', email: 'medical@test.invalid', description: 'Medical information' }, undefined)
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
  it.each([['Add', undefined], ['Edit', division]])('%s Division: a name already used shows under Name only, focused, until the name changes', async (_, edited) => {
    host.save.mockRejectedValue(new DuplicateNameError('division'))
    const component = () => DivisionForm({ division: edited, onClose: vi.fn() })
    if (!edited) {
      const fields = elements(render(component))
      change(fields.find((item) => item.props.name === 'divisionName')!, 'Safety')
      change(elements(render(component)).find((item) => item.props.name === 'divisionEmail')!, 'safety@test.invalid')
      change(elements(render(component)).find((item) => item.props.name === 'divisionDescription')!, 'Safety work')
    }
    render(component)
    const [nameFocus] = focusable()
    await expect(confirm(render(component))).resolves.toBe(false)
    const name = () => elements(render(component)).find((item) => item.props.name === 'divisionName')!
    expect(name().props.error).toBe('A division with this name already exists. Please choose a different name.')
    expect(nameFocus).toHaveBeenCalled()
    expect(elements(render(component)).some((item) => item.props.role === 'alert')).toBe(false)
    // The same name again is refused before saving; another name clears the message.
    host.save.mockClear()
    await expect(confirm(render(component))).resolves.toBe(false)
    expect(host.save).not.toHaveBeenCalled()
    change(name(), 'Safety Two')
    expect(name().props.error).toBeUndefined()
  })
})
describe('division preview', () => {
  const preview = (props: Partial<Parameters<typeof DivisionPreview>[0]> = {}) => render(() => DivisionPreview({ division, onClose: vi.fn(), ...props }))
  const markup = (props: Partial<Parameters<typeof DivisionPreview>[0]> = {}) => { host.index = 0; return renderToStaticMarkup(<DivisionPreview division={division} onClose={vi.fn()} {...props} />) }

  it('shows the Description and Email labels in bold, their values in regular text', () => {
    const html = markup()
    expect(html).toContain('<dt class="font-bold text-maroon">Description</dt><dd class="mt-1 break-words text-black">Safety work</dd>')
    expect(html).toContain('<dt class="font-bold text-maroon">Email</dt>')
    expect(html).toMatch(/<span class="min-w-0 break-all text-black">safety@test.invalid<\/span>/)
    expect(html).not.toMatch(/<dd[^>]*font-(?:bold|semibold)/)
  })

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

  it.each([['null', null], ['empty', ''], ['whitespace-only', '  \n ']])('says Not provided. (muted) when the description is %s', (_, description) => {
    const html = markup({ division: { ...division, description } })
    expect(html).toMatch(/>Description<\/dt><dd class="mt-1 text-text-gray">Not provided.</)
    expect(html.match(/<dt[^>]*>([^<]*)<\/dt>/g)!.map((tag) => tag.replace(/<[^>]+>/g, ''))).toEqual(['Description', 'Email'])
  })

  it('has only Close: no Edit button', () => {
    const onClose = vi.fn()
    const element = preview({ onClose })
    expect(markup()).not.toMatch(/>Edit</)
    expect(elements(element).some((item) => typeof item.props.onClick === 'function')).toBe(false)
    expect(element.props.confirmLabel).toBe('Close')
    expect(element.props.cancelLabel).toBeUndefined()
    ;(element.props.onClose as () => void)()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
describe('delete department dialog', () => {
  const department = { id: 'd', name: 'Medical', updated_at: 'revision' }
  it('deletes a department without SOPs with a plain confirmation: no SOP options', async () => {
    const onDeleted = vi.fn()
    const element = render(() => DeleteDepartmentDialog({ department, onClose: vi.fn(), onDeleted }))
    expect(element.props).toMatchObject({ title: 'Delete Medical?', confirmLabel: 'Delete', cancelLabel: 'Cancel' })
    expect(elements(element).some((item) => item.props.type === 'radio' || item.props.type === 'checkbox')).toBe(false)
    const html = renderToStaticMarkup(<DeleteDepartmentDialog department={department} onClose={vi.fn()} onDeleted={vi.fn()} />)
    expect(html).not.toMatch(/Move SOPs to Others|Delete associated SOPs|I confirm deletion/)
    expect(html).toContain('Deleting this department will remove it, and it can’t be restored.')
    await confirm(render(() => DeleteDepartmentDialog({ department, onClose: vi.fn(), onDeleted })))
    expect(host.remove).toHaveBeenCalledWith(department, 'empty')
    expect(onDeleted).toHaveBeenCalledOnce()
  })
  it('keeps Retry file cleanup for a deletion confirmed earlier', async () => {
    const pending = { ...department, deletion_job_id: 'job' }
    const element = render(() => DeleteDepartmentDialog({ department: pending, onClose: vi.fn(), onDeleted: vi.fn() }))
    expect(element.props.confirmLabel).toBe('Retry file cleanup')
    expect(elements(element).some((item) => item.props.children === 'This deletion was already confirmed. Retry to remove any remaining files and finish deleting the department.')).toBe(true)
    await confirm(element)
    expect(host.remove).toHaveBeenCalledWith(pending, 'delete')
  })
  it('shows a refusal inside the dialog and stays open', async () => {
    host.remove.mockRejectedValue(new Error('This department can’t be deleted because it has SOPs.'))
    const component = () => DeleteDepartmentDialog({ department, onClose: vi.fn(), onDeleted: vi.fn() })
    await expect(confirm(render(component))).resolves.toBe(false)
    expect(elements(render(component)).some((item) => item.props.role === 'alert' && item.props.children === 'This department can’t be deleted because it has SOPs.')).toBe(true)
  })
  it('cancel changes no relationships', () => {
    const onClose = vi.fn()
    const element = render(() => DeleteDepartmentDialog({ department, onClose, onDeleted: vi.fn() }))
    ;(element.props.onClose as () => void)()
    expect(onClose).toHaveBeenCalledOnce(); expect(host.remove).not.toHaveBeenCalled()
  })
})
