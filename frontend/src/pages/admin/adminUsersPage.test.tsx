import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import { usersEn } from '../../content/users.en'
import type { Department, User } from '../../data/mock/types'
import { ALL_FILTER, filterUsers, NO_DIVISION } from '../../lib/userAdmin'
import { PermissionBadges } from '../../components/admin/UserBits'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { AdminUsersPage } from './AdminUsersPage'

const fixture = vi.hoisted(() => ({
  users: [
    { id: 'admin', name: 'Nouf Admin', email: 'nouf@example.test', initials: 'NA', departmentId: 'qa', permissions: ['admin'] },
    { id: 'sara', name: 'Sara Aljuraybah', email: 'sara@example.test', initials: 'SA', departmentId: 'pv', permissions: ['author', 'reviewer'] },
    { id: 'reem', name: 'Reem Alharbi', email: 'reem@example.test', initials: 'RA', departmentId: 'qa', permissions: ['approver'] },
  ] as User[],
  departments: [
    { id: 'pv', name: 'Pharmacovigilance', initials: 'PV', description: '', divisionId: 'Regulatory & Drug Safety' },
    { id: 'qa', name: 'Quality Assurance', initials: 'QA', description: '' },
  ] as Department[],
}))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ activeUsers: fixture.users, deleteUser: vi.fn() }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => fixture.users[0] }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: [] }) }))
vi.mock('../../state/departmentsContext', () => ({
  useDepartments: () => ({ activeDepartments: fixture.departments, getDepartment: (id: string) => fixture.departments.find((item) => item.id === id) }),
}))

const render = () => renderToStaticMarkup(<MemoryRouter><AdminUsersPage /></MemoryRouter>)
const table = (html: string) => html.slice(html.indexOf('<table'), html.indexOf('</table>'))
const getDepartment = (id: string) => fixture.departments.find((item) => item.id === id)
const search = (query: string, division = ALL_FILTER, departmentId = ALL_FILTER) =>
  filterUsers(fixture.users, getDepartment, { query, division, departmentId }, usersEn.permissions).map((user) => user.id)

describe('Users list', () => {
  it('has the columns Name, Division, Department, Permission and Actions, without Email', () => {
    const html = table(render())
    const columns = [...html.matchAll(/<th scope="col"[^>]*>(?:<span class="sr-only">)?([^<]+)(?:<\/span>)?<\/th>/g)].map((match) => match[1])
    expect(columns).toEqual(['Name', 'Division', 'Department', 'Permission', 'Actions'])
    // "Actions" is the column's accessible name only.
    expect(html).toContain('<span class="sr-only">Actions</span></th>')
    // The admin sidebar's maroon, with off-white text, on every header cell (keeping the rounded corners).
    expect(html).toContain('<thead class="text-offwhite [&amp;_th]:bg-maroon">')
    for (const th of html.match(/<th scope="col" class="[^"]*"/g)!) expect(th).toContain('first:rounded-tl-xl last:rounded-tr-xl')
    expect(html).not.toContain('sara@example.test')
    // The division of the department, or — without one.
    expect(html).toContain('>Regulatory &amp; Drug Safety<')
    expect(html.match(/<td[^>]*>—<\/td>/g)).toHaveLength(2)
  })

  it('makes only the buttons interactive: the row isn\'t a link and the name is plain text', () => {
    const html = table(render())
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('after:absolute')
    expect(html).toMatch(/<th scope="row"[^>]*><span[^>]*><span[^>]*>SA<\/span>Sara Aljuraybah<\/span><\/th>/)
  })

  it('gives every user View, Edit and Delete icon buttons, named and with tooltips', () => {
    const html = table(render())
    for (const user of fixture.users) {
      for (const label of [`View ${user.name}`, `Edit ${user.name}`, `Delete ${user.name}`]) {
        expect(html).toContain(`aria-label="${label}"`)
        expect(html).toMatch(new RegExp(`role="tooltip"[^>]*><span[^>]*>${label}</span>`))
      }
    }
    // Delete is never disabled, not even on the signed-in admin's own row.
    expect(html).not.toContain('aria-disabled="true"')
    expect(html.match(/aria-label="Delete [^"]+"[^>]*>/g)!.every((button) => button.includes('text-status-rejected-fg'))).toBe(true)
  })

  it('shows the same users and actions as stacked cards on narrow screens', () => {
    const html = render()
    const cards = html.slice(html.indexOf('<ul aria-label="Users"'), html.lastIndexOf('</ul>'))
    expect(cards).toContain('md:hidden')
    for (const user of fixture.users) {
      expect(cards).toContain(`>${user.name}<`)
      expect(cards).toContain(`aria-label="Delete ${user.name}"`)
    }
    expect(html).toContain('hidden md:block')
  })

  it('offers one search, and the Division and Department filters, with the count', () => {
    const html = render()
    expect(html).toContain('>Search Users<')
    expect(html).toContain('placeholder="Search by name, email, division, department or permission…"')
    expect(html).toContain('>All Divisions<')
    expect(html).toContain('>Regulatory &amp; Drug Safety</option>')
    expect(html).toContain('>No Division</option>')
    expect(html).toContain('>All Departments<')
    expect(html).not.toContain('All Permissions')
    expect(html).toContain('>3 users<')
  })
})

describe('searching and filtering users', () => {
  it('matches name, email, division, department and permission names, ignoring case', () => {
    expect(search('SARA')).toEqual(['sara'])
    expect(search('reem@example')).toEqual(['reem'])
    expect(search('drug safety')).toEqual(['sara'])
    expect(search('quality')).toEqual(['admin', 'reem'])
    expect(search('approver')).toEqual(['reem'])
    expect(search('ADMIN')).toEqual(['admin'])
    expect(search('nobody')).toEqual([])
    expect(search('  ')).toEqual(['admin', 'reem', 'sara'])
  })

  it('combines the search with the Division and Department filters', () => {
    expect(search('', 'Regulatory & Drug Safety')).toEqual(['sara'])
    expect(search('', NO_DIVISION)).toEqual(['admin', 'reem'])
    expect(search('', ALL_FILTER, 'qa')).toEqual(['admin', 'reem'])
    expect(search('reem', NO_DIVISION, 'qa')).toEqual(['reem'])
    expect(search('sara', NO_DIVISION)).toEqual([])
  })

  it('says when no user matches', () => {
    expect(adminEn.usersList.empty).toBe('No users match your search.')
  })
})

describe('the Delete User warning', () => {
  it('asks "Delete User?" with Cancel first and Delete in the primary filled style', () => {
    const text = adminEn.deleteUser
    const html = renderToStaticMarkup(
      <ConfirmDialog open title={text.title} description={text.description.replace('{name}', 'Sara Aljuraybah')}
        cancelLabel={text.cancel} confirmLabel={text.confirm} onConfirm={() => {}} onCancel={() => {}} />,
    )
    expect(html).toContain('>Delete User?</h2>')
    expect(html).toContain("Are you sure you want to delete Sara Aljuraybah? This can&#x27;t be undone.")
    const cancel = html.match(/<button[^>]*>Cancel<\/button>/)![0]
    const remove = html.match(/<button[^>]*>Delete<\/button>/)![0]
    expect(cancel).toContain('autofocus')
    expect(html.indexOf('>Cancel<')).toBeLessThan(html.indexOf('>Delete<'))
    expect(remove).toContain('bg-maroon')
    expect(remove).not.toContain('text-status-rejected-fg')
  })
})

describe('permission badges', () => {
  it('use the sidebar Admin tag\'s tokens with a lighter gold (60%) everywhere, Employee included', () => {
    const tag = ['rounded-md', 'bg-gold-light/60', 'px-1.5', 'py-0.5', 'text-xs', 'font-semibold', 'text-maroon']
    const html = render() + renderToStaticMarkup(<PermissionBadges user={{ permissions: [] }} />)
    const badges = [...html.matchAll(/<li class="([^"]*)">([^<]+)<\/li>/g)]
    expect(badges.map((match) => match[2])).toContain('Employee')
    for (const [, classes] of badges) {
      for (const token of tag) expect(classes.split(' ')).toContain(token)
      expect(classes).not.toMatch(/border|rounded-full|px-2\.5/)
    }
  })
})
