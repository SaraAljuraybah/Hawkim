import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import { AddUserPage } from './AddUserPage'

vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ activeUsers: [], addUser: vi.fn() }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ activeDepartments: [{ id: 'plain', name: 'Plain Department', initials: 'PL', description: '' }] }) }))

const html = renderToStaticMarkup(<MemoryRouter><AddUserPage /></MemoryRouter>)
const label = (text: string) => html.match(new RegExp(`<label[^>]*>${text}(.*?)</label>`))![1]

describe('Add User', () => {
  it.each(['Full Name', 'Email', 'Department'])('marks %s as required, visibly and for screen readers', (text) => {
    expect(label(text)).toContain('>*<')
    expect(label(text)).toContain('aria-hidden="true"')
    const id = html.match(new RegExp(`<label for="([^"]+)"[^>]*>${text}`))![1]
    expect(html.match(new RegExp(`<(?:input|select)[^>]*id="${id}"[^>]*>`))![0]).toContain('required=""')
  })

  it('puts Division right under Department, not required until a department has one', () => {
    expect(html.indexOf('name="division"')).toBeGreaterThan(html.indexOf('name="department"'))
    expect(html.indexOf('name="division"')).toBeLessThan(html.indexOf('name="permissions"'))
    expect(label('Division')).not.toContain('>*<')
  })

  it('calls the section Role, optional, without the grey text, keeping each role\'s description', () => {
    expect(html).toContain('>Role<')
    expect(html).not.toContain('Permissions (Optional)')
    expect(html).not.toContain('Every user is an employee')
    for (const description of Object.values(adminEn.permissionDescriptions)) expect(html).toContain(description.replace(/'/g, '&#x27;'))
  })
})
