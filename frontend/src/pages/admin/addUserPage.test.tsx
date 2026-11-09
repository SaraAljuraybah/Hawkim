import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import type { Department } from '../../data/mock/types'
import { AddUserPage } from './AddUserPage'

const plain: Department = { id: 'plain', name: 'Plain Department', initials: 'PL', description: '' }
let departments: Department[] = [plain]

vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ activeUsers: [], addUser: vi.fn() }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ activeDepartments: departments }) }))

const render = () => renderToStaticMarkup(<MemoryRouter><AddUserPage /></MemoryRouter>)
const html = render()
const label = (text: string) => html.match(new RegExp(`<label[^>]*>${text}(.*?)</label>`))![1]
const control = (markup: string, name: string) => markup.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))![0]

describe('Add User', () => {
  it.each(['Full Name', 'Email', 'Phone Number', 'Division', 'Department', 'Position'])('marks %s as required, visibly and for screen readers', (text) => {
    expect(label(text)).toContain('>*<')
    expect(label(text)).toContain('aria-hidden="true"')
    const id = html.match(new RegExp(`<label for="([^"]+)"[^>]*>${text}`))![1]
    expect(html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))![0]).toContain('required=""')
  })

  it('orders the fields Full Name, Email, Phone Number, Division, Department, Position, Permission', () => {
    const order = ['name="name"', 'name="email"', 'name="phone"', 'name="division"', 'name="department"', 'name="position"', 'name="permissions"'].map((name) => html.indexOf(name))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('takes the 8 digits after a fixed "+9665", with the number keyboard, read as one labelled control', () => {
    const phone = control(html, 'phone')
    expect(phone).toContain('inputMode="numeric"')
    expect(phone).not.toContain('maxLength')
    // The prefix is read first, then the hint.
    const [prefixId, hintId] = phone.match(/aria-describedby="([^"]+)"/)![1].split(' ')
    expect(html).toContain(`<span id="${prefixId}">+9665</span>`)
    expect(html).toContain(`<p id="${hintId}" class="text-sm text-text-gray">Saudi mobile number: +9665XXXXXXXX</p>`)
    expect(adminEn.addUser.errors.phoneInvalid).toBe('Enter the 8 digits after +9665.')
  })

  it('limits Position to 100 characters, without a counter or hint', () => {
    expect(control(html, 'position')).toContain('maxLength="100"')
    expect(control(html, 'position')).not.toContain('aria-describedby')
    expect(html).not.toMatch(/\d+ \/ 100/)
    expect(html).not.toContain('Job title')
  })

  it('makes Division and Department searchable dropdowns', () => {
    for (const name of ['division', 'department']) {
      expect(control(html, name)).toContain('role="combobox"')
      expect(control(html, name)).toContain('aria-autocomplete="list"')
    }
  })

  it('chooses No Division from the start when it is the only choice, so Department is ready', () => {
    expect(control(html, 'division')).toContain('value="No Division"')
    expect(control(html, 'department')).not.toContain('disabled=""')
    expect(html).toContain('>Plain Department<')
  })

  it('keeps Department waiting until a division is chosen when real divisions exist', () => {
    departments = [plain, { ...plain, id: 'grouped', name: 'Grouped Department', divisionId: 'Medical Division' }]
    const markup = render()
    departments = [plain]
    expect(control(markup, 'division')).toContain('value=""')
    expect(control(markup, 'department')).toContain('disabled=""')
    expect(control(markup, 'department')).toContain('placeholder="Select a Division First"')
    expect(markup).not.toContain('>Plain Department<')
  })

  it('calls the section Permission, optional, keeping each permission\'s description', () => {
    expect(html).toContain('>Permission<')
    expect(html).not.toContain('>Role<')
    for (const description of Object.values(adminEn.permissionDescriptions)) expect(html).toContain(description.replace(/'/g, '&#x27;'))
  })
})
