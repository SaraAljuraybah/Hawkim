import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DepartmentForm } from './DepartmentDialog'
import type { ManagementSnapshot } from '../../services/organizationAdmin'

// Hooks as plain storage, so the dialog can be called as a function and its handlers run without a browser.
const host = vi.hoisted(() => ({
  states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, save: vi.fn(), reload: vi.fn(),
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
vi.mock('../../services/organizationAdmin', () => ({ saveDepartment: host.save }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ reload: host.reload }) }))

const snapshot: ManagementSnapshot = {
  divisions: [
    { id: 'medical', name: 'Medical Division', description: '', email: null, updated_at: 'v1' },
    { id: 'quality', name: 'Quality Division', description: '', email: null, updated_at: 'v1' },
  ],
  departments: [
    { id: 'qa', name: 'Quality Assurance', initials: 'QA', description: 'Audits', email: 'qa@test.invalid', division_id: 'quality', updated_at: 'r1', people: [], employees: 0, sops: 0, status_counts: {} },
    { id: 'legacy', name: 'Legacy', initials: 'LG', description: '', division_id: null, updated_at: 'r2', people: [], employees: 0, sops: 0, status_counts: {} },
  ],
}
const qa = snapshot.departments[0]
const legacy = snapshot.departments[1]

type Element = ReactElement<Record<string, unknown>>
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
type Props = Parameters<typeof DepartmentForm>[0]
const render = (props: Partial<Props> = {}) => {
  host.index = 0; host.refIndex = 0
  return DepartmentForm({ snapshot, onClose: vi.fn(), ...props }) as Element
}
const markup = (props: Partial<Props> = {}) => {
  host.states = []; host.refs = []; host.index = 0; host.refIndex = 0
  return renderToStaticMarkup(<DepartmentForm snapshot={snapshot} onClose={vi.fn()} {...props} />)
}
const field = (element: Element, name: string) => elements(element).find((item) => item.props.name === name)!
const change = (element: Element, name: string, value: string) => (field(element, name).props.onChange as (event: unknown) => void)({ target: { value } })
const confirm = (element: Element) => (element.props.onConfirm as () => Promise<boolean | void>)()
/** Stand-ins for the rendered fields, in the dialog's ref order: name, division, email, description. */
const focusable = () => host.refs.slice(0, 4).map((ref) => { const focus = vi.fn(); ref.current = { focus }; return focus })

beforeEach(() => {
  host.states = []; host.refs = []; host.index = 0; host.refIndex = 0
  vi.clearAllMocks()
  host.save.mockResolvedValue('department-new')
  host.reload.mockResolvedValue(undefined)
})

describe('department dialog layout', () => {
  it('has Name, Division, Email and Description in that order', () => {
    const html = markup({ divisionId: 'medical' })
    expect([...html.matchAll(/<(?:input|select|textarea)[^>]*name="([^"]+)"/g)].map((match) => match[1]))
      .toEqual(['departmentName', 'departmentDivision', 'departmentEmail', 'departmentDescription'])
  })

  it('marks Name and Division as required (asterisk and for screen readers), Email and Description not', () => {
    const html = markup({ divisionId: 'medical' })
    const control = (name: string) => html.match(new RegExp(`<(?:input|select|textarea)[^>]*name="${name}"[^>]*>`))![0]
    expect(control('departmentName')).toContain('required=""')
    expect(control('departmentDivision')).toContain('required=""')
    expect(control('departmentEmail')).not.toContain('required=""')
    expect(control('departmentDescription')).not.toContain('required=""')
    const label = (text: string) => html.match(new RegExp(`<label[^>]*>${text}(.*?)</label>`))![1]
    expect(label('Name')).toContain('>*<')
    expect(label('Division')).toContain('>*<')
    expect(label('Email')).not.toContain('>*<')
    expect(label('Description')).not.toContain('>*<')
  })

  it('is titled Add Department, with Cancel then Save (Save on the right)', () => {
    const html = markup({ divisionId: 'medical' })
    expect(html).toMatch(/<h2[^>]*>Add Department<\/h2>/)
    const footer = html.match(/<div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">[\s\S]*<\/div>/)![0]
    expect([...footer.matchAll(/<button[^>]*>(?:<[^>]+>)*([^<]+)</g)].map((match) => match[1])).toEqual(['Cancel', 'Save'])
  })

  it('is titled Edit Department, with Cancel then Save Changes', () => {
    const html = markup({ department: qa })
    expect(html).toMatch(/<h2[^>]*>Edit Department<\/h2>/)
    expect(html).toMatch(/>Cancel<\/button><button type="submit"[^>]*>Save Changes<\/button>/)
  })

  it('shows the division whose Add Department was used as a fixed, read-only field (no dropdown)', () => {
    const html = markup({ divisionId: 'medical' })
    expect(html).not.toContain('<select')
    expect(html).not.toContain('lucide-chevron-down')
    const input = html.match(/<input[^>]*name="departmentDivision"[^>]*>/)![0]
    expect(input).toContain('readOnly=""')
    expect(input).toContain('value="Medical Division"')
    expect(html).toMatch(/<label[^>]*>Division<span[^>]*>\*<\/span><\/label>/)
  })

  it('shows the division of the Add Department used now, not one from before', () => {
    expect(markup({ divisionId: 'medical' })).toContain('value="Medical Division"')
    const html = markup({ divisionId: 'quality' })
    expect(html).toContain('value="Quality Division"')
    expect(html).not.toContain('Medical Division')
  })

  it('lets the admin choose when the division is no longer available', () => {
    const division = field(render({ divisionId: 'gone' }), 'departmentDivision')
    expect(division.props.value).toBe('')
    expect(division.props.options).toBeDefined()
  })

  it('starts from the saved values when editing', () => {
    const element = render({ department: qa })
    expect(['departmentName', 'departmentDivision', 'departmentEmail', 'departmentDescription'].map((name) => field(element, name).props.value))
      .toEqual(['Quality Assurance', 'quality', 'qa@test.invalid', 'Audits'])
  })

  it('has no hint under Description, but a character counter linked to the field, up to 200', () => {
    const html = markup({ divisionId: 'medical' })
    expect(html).not.toContain('One line about what the department does')
    const textarea = html.match(/<textarea[^>]*name="departmentDescription"[^>]*>/)![0]
    expect(textarea).toContain('maxLength="200"')
    const counterId = html.match(/<p id="([^"]+-counter)"[^>]*>0 \/ 200<\/p>/)![1]
    expect(textarea.match(/aria-describedby="([^"]*)"/)![1].split(' ')).toContain(counterId)
    // Not a live region: read with the field, not on every keystroke.
    expect(html).not.toContain('aria-live')
  })

  it('counts the description as it changes, starting from the saved one when editing', () => {
    expect(field(render({ department: qa }), 'departmentDescription').props.counter).toBe('6 / 200')
    change(render({ department: qa }), 'departmentDescription', 'x'.repeat(200))
    expect(field(render({ department: qa }), 'departmentDescription').props.counter).toBe('200 / 200')
  })

  it('lets a legacy department without a division keep none (not required)', () => {
    const division = field(render({ department: legacy }), 'departmentDivision')
    expect(division.props).toMatchObject({ value: '', required: false, requiredMark: false })
    expect((division.props.options as { value: string; label: string }[])[0]).toEqual({ value: '', label: 'No division (existing assignment)' })
  })
})

describe('saving from the department dialog', () => {
  it('refuses an empty name and a missing division, says why and focuses the first invalid field (Name)', async () => {
    render()
    const [name, division] = focusable()
    await expect(confirm(render())).resolves.toBe(false)
    const element = render()
    expect(field(element, 'departmentName').props.error).toBe('Enter a department name.')
    expect(field(element, 'departmentDivision').props.error).toBe('Select a division.')
    expect(name).toHaveBeenCalledOnce()
    expect(division).not.toHaveBeenCalled()
    expect(host.save).not.toHaveBeenCalled()
  })

  it('focuses Email when it is the first invalid field', async () => {
    change(render({ divisionId: 'medical' }), 'departmentName', 'Pharmacovigilance')
    change(render({ divisionId: 'medical' }), 'departmentEmail', 'not-an-email')
    const [name, , email] = focusable()
    await expect(confirm(render({ divisionId: 'medical' }))).resolves.toBe(false)
    expect(field(render({ divisionId: 'medical' }), 'departmentEmail').props.error).toBe('Enter a valid email address, e.g. name@example.com (up to 254 characters).')
    expect(email).toHaveBeenCalledOnce()
    expect(name).not.toHaveBeenCalled()
  })

  it('keeps the name, description and uniqueness rules', async () => {
    change(render({ divisionId: 'medical' }), 'departmentName', 'quality assurance')
    change(render({ divisionId: 'medical' }), 'departmentDescription', 'x'.repeat(201))
    await confirm(render({ divisionId: 'medical' }))
    const element = render({ divisionId: 'medical' })
    expect(field(element, 'departmentName').props.error).toBe('A department with this name already exists.')
    expect(field(element, 'departmentDescription').props.error).toBe('Keep the description to 200 characters or fewer.')
  })

  it('adds a department with generated initials, then reports it', async () => {
    const onSaved = vi.fn()
    change(render({ divisionId: 'medical', onSaved }), 'departmentName', 'Clinical Operations')
    change(render({ divisionId: 'medical', onSaved }), 'departmentEmail', ' clinops@test.invalid ')
    await expect(confirm(render({ divisionId: 'medical', onSaved }))).resolves.toBeUndefined()
    expect(host.save).toHaveBeenCalledWith({ name: 'Clinical Operations', divisionId: 'medical', email: ' clinops@test.invalid ', description: '', initials: 'CO' }, undefined, undefined)
    expect(host.reload).toHaveBeenCalledOnce()
    expect(onSaved).toHaveBeenCalledWith('added')
  })

  it('saves under the division whose Add Department was used, even if the form state names another', async () => {
    change(render({ divisionId: 'medical' }), 'departmentName', 'Clinical Operations')
    // Simulate a tampered form state: the fixed division's id is still the one saved.
    const values = host.states.find((state) => (state as { divisionId?: string })?.divisionId === 'medical') as { divisionId: string }
    values.divisionId = 'quality'
    await expect(confirm(render({ divisionId: 'medical' }))).resolves.toBeUndefined()
    expect(host.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Clinical Operations', divisionId: 'medical' }), undefined, undefined)
  })

  it('edits with the department id and the version it opened with, and regenerates initials on a rename', async () => {
    const onSaved = vi.fn()
    change(render({ department: qa, onSaved }), 'departmentName', 'Research & Development')
    await confirm(render({ department: qa, onSaved }))
    expect(host.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Research & Development', initials: 'RD', divisionId: 'quality', email: 'qa@test.invalid' }), 'qa', 'r1')
    expect(onSaved).toHaveBeenCalledWith('updated')
  })

  it('saves a legacy department without a division', async () => {
    await confirm(render({ department: legacy }))
    expect(host.save).toHaveBeenCalledWith(expect.objectContaining({ divisionId: null, initials: 'LG' }), 'legacy', 'r2')
  })

  it('keeps the dialog open and shows a server error inside it', async () => {
    host.save.mockRejectedValue(new Error('Someone else changed this record. Refresh the page and try again.'))
    const onSaved = vi.fn()
    await expect(confirm(render({ department: qa, onSaved }))).resolves.toBe(false)
    expect(elements(render({ department: qa, onSaved })).some((item) => item.props.role === 'alert'
      && item.props.children === 'Someone else changed this record. Refresh the page and try again.')).toBe(true)
    expect(onSaved).not.toHaveBeenCalled()
  })
})
