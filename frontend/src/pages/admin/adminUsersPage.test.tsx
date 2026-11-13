import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import { usersEn } from '../../content/users.en'
import type { Department, User } from '../../data/mock/types'
import { clearedStaffParams, filterUsers, type StaffSort } from '../../lib/userAdmin'
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
    { id: 'pv', name: 'Pharmacovigilance', initials: 'PV', description: '', divisionId: 'regulatory_drug_safety', divisionName: 'Regulatory and Drug Safety' },
    { id: 'qa', name: 'Quality Assurance', initials: 'QA', description: '' },
  ] as Department[],
}))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: fixture.users, activeUsers: fixture.users, deleteUser: vi.fn(), reactivateUser: vi.fn() }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => fixture.users[0] }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: [] }) }))
vi.mock('../../state/departmentsContext', () => ({
  useDepartments: () => ({ activeDepartments: fixture.departments, getDepartment: (id: string) => fixture.departments.find((item) => item.id === id) }),
}))

const render = (search = '') => renderToStaticMarkup(<MemoryRouter initialEntries={[`/admin/users${search}`]}><AdminUsersPage /></MemoryRouter>)
const table = (html: string) => html.slice(html.indexOf('<table'), html.indexOf('</table>'))
const getDepartment = (id: string) => fixture.departments.find((item) => item.id === id)
const search = (query: string, divisions: string[] = [], departmentIds: string[] = []) =>
  filterUsers(fixture.users, getDepartment, { query, divisions, departmentIds }, usersEn.permissions).map((user) => user.id)
/** The Filter field's button (FilterPopover). */
const filterField = (html: string) => html.match(/<label for="[^"]+" class="mb-1\.5 block text-sm font-medium text-maroon">Filter<\/label><button[^>]*>.*?<\/button>/)![0]
/** A section's chip labels (and whether each is on), in order. */
const chips = (html: string, legend: string) => {
  const start = html.indexOf(`>${legend}</legend>`)
  const section = html.slice(start, html.indexOf('</fieldset>', start))
  return [...section.matchAll(/aria-pressed="(true|false)"[^>]*>(?:<svg.*?<\/svg>)?<span[^>]*>([^<]+)<\/span>/g)].map((match) => match[2] + (match[1] === 'true' ? ' ✓' : ''))
}

/** How many staff rows the table shows. */
const rowCount = (html: string) => [...table(html).matchAll(/<th scope="row"/g)].length

/** The fixture's staff: everyone but the administrators. */
const staffOnly = () => fixture.users.filter((user) => !user.permissions.includes('admin'))

describe('Users list', () => {
  it('has the columns Name, Division, Department, Permission, then Preview, Edit and Delete with visible headings, without Email', () => {
    const html = table(render())
    const columns = [...html.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((match) => match[1])
    expect(columns).toEqual(['Name', 'Division', 'Department', 'Permission', 'Preview', 'Edit', 'Delete'])
    expect(html).not.toContain('sr-only">Actions')
    // As on Divisions and Departments: 6rem per action column, each heading centred above its button.
    expect(html).toContain('<colgroup><col/><col/><col/><col/><col class="w-24"/><col class="w-24"/><col class="w-24"/></colgroup>')
    for (const heading of ['Preview', 'Edit', 'Delete']) {
      expect(html).toContain(`<th scope="col" class="px-2 py-3 text-center font-semibold last:rounded-tr-xl">${heading}</th>`)
    }
    // The admin sidebar's maroon, with off-white text, on every header cell (keeping the rounded corners).
    expect(html).toContain('<thead class="text-offwhite [&amp;_th]:bg-maroon">')
    const headers = html.match(/<th scope="col" class="[^"]*"/g)!
    expect(headers[0]).toContain('first:rounded-tl-xl')
    expect(headers.at(-1)).toContain('last:rounded-tr-xl')
    expect(html).not.toContain('sara@example.test')
    // The division of the department, or — without one.
    expect(html).toContain('>Regulatory and Drug Safety<')
    // Only Reem's department has no division (the administrator without one isn't listed).
    expect(html.match(/<td[^>]*>—<\/td>/g)).toHaveLength(1)
  })

  it('makes only the buttons interactive: the row isn\'t a link and the name is plain text', () => {
    const html = table(render())
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('after:absolute')
    expect(html).toMatch(/<th scope="row"[^>]*><span[^>]*><span[^>]*>SA<\/span>Sara Aljuraybah<\/span><\/th>/)
  })

  it('gives every staff member View, Edit and Delete icon buttons, named and with tooltips', () => {
    const html = table(render())
    for (const user of staffOnly()) {
      for (const label of [`View ${user.name}`, `Edit ${user.name}`, `Delete ${user.name}`]) {
        expect(html).toContain(`aria-label="${label}"`)
        expect(html).toMatch(new RegExp(`role="tooltip"[^>]*><span[^>]*>${label}</span>`))
      }
    }
    // Delete is never disabled, not even on the signed-in admin's own row.
    expect(html).not.toContain('aria-disabled="true"')
    expect(html.match(/aria-label="Delete [^"]+"[^>]*>/g)!.every((button) => button.includes('text-status-rejected-fg'))).toBe(true)
  })

  it('puts each action in its own centred cell, in the order Preview, Edit, Delete', () => {
    const rows = table(render()).split('<tr>').slice(2)
    expect(rows).toHaveLength(staffOnly().length)
    for (const row of rows) {
      const cells = [...row.matchAll(/<td class="px-2 py-3\.5 text-center \[&amp;&gt;\*\]:mx-auto">(.*?)<\/td>/g)].map((match) => match[1])
      expect(cells.map((cell) => cell.match(/aria-label="(\w+) /)?.[1])).toEqual(['View', 'Edit', 'Delete'])
    }
  })

  it('shows the same users and actions as stacked cards on narrow screens', () => {
    const html = render()
    const cards = html.slice(html.indexOf('<ul aria-label="Staff"'), html.lastIndexOf('</ul>'))
    expect(cards).toContain('md:hidden')
    for (const user of staffOnly()) {
      expect(cards).toContain(`>${user.name}<`)
      expect(cards).toContain(`aria-label="Delete ${user.name}"`)
    }
    expect(html).toContain('hidden md:block')
  })

  it('offers one search and the one Filter field of every list page, with the count', () => {
    const html = render()
    expect(html).toContain('>Search Staff<')
    expect(html).toContain('placeholder="Search by staff name, email, division, department"')
    // No description under the title.
    expect(html).not.toContain('Manage who can use Hawkim and what they can do.')
    // The only dropdown is Sort; the Filter is the shared panel, not a select.
    expect(html.match(/<select/g)).toHaveLength(1)
    expect(html).toContain('name="staffSort"')
    expect(html).not.toContain('Filter by Division')
    // One Filter field ("All" while nothing is chosen) opening the shared panel.
    expect(filterField(html)).toMatch(/^<label[^>]*>Filter<\/label><button id="[^"]+" type="button" aria-label="Filter" aria-expanded="false" aria-controls="[^"]+"/)
    expect(filterField(html)).toContain('>All</span>')
    expect(html).toMatch(/role="group" aria-labelledby="[^"]+"[^>]*><div[^>]*><h2 id="[^"]+" class="text-base">Filters<\/h2>/)
    // Division chips; Department chips under their division, departments without one last.
    expect(chips(html, 'Division')).toEqual(['Regulatory and Drug Safety'])
    expect(chips(html, 'Department')).toEqual(['Pharmacovigilance', 'Quality Assurance'])
    expect(html).toContain('>Unassigned departments</p>')
    expect(html).not.toContain('All Permissions')
    // Administrators aren't staff, so Nouf (an admin) isn't counted.
    expect(rowCount(html)).toBe(2)
    expect(html).not.toContain('staff members')
    // Nothing to clear yet.
    expect(html).not.toContain('>Clear Filters<')
  })

  it('leaves out administrators: they are on Manage Organization → Admins', () => {
    const admins = fixture.users.filter((user) => user.permissions.includes('admin'))
    expect(admins.length).toBeGreaterThan(0)
    const html = render()
    for (const admin of admins) {
      expect(html).not.toContain(`>${admin.name}<`)
      expect(html).not.toContain(`aria-label="View ${admin.name}"`)
    }
  })

  it('reads the Filter from the URL with the linked rule, with the summary, the count and Clear Filters', () => {
    // A division: its departments only, and only its departments are offered.
    const byDivision = render('?division=regulatory_drug_safety,gone')
    expect(rowCount(byDivision)).toBe(1)
    expect(filterField(byDivision)).toContain('aria-label="Filter: 1 division"')
    expect(filterField(byDivision)).toContain('>1 division</span>')
    expect(chips(byDivision, 'Division')).toEqual(['Regulatory and Drug Safety ✓'])
    expect(chips(byDivision, 'Department')).toEqual(['Pharmacovigilance'])
    expect(byDivision).toContain('>Clear Filters<')
    // A department without a division (Reem; Nouf is there too, but is an administrator).
    const byDepartment = render('?dept=qa')
    expect(rowCount(byDepartment)).toBe(1)
    expect(filterField(byDepartment)).toContain('>1 department</span>')
    // A department outside the selected division is no longer offered, so it's dropped.
    const dropped = render('?division=regulatory_drug_safety&dept=qa')
    expect(rowCount(dropped)).toBe(1)
    expect(filterField(dropped)).toContain('>1 division</span>')
    // Both, in the same division.
    expect(filterField(render('?division=regulatory_drug_safety&dept=pv'))).toContain('>1 division, 1 department</span>')
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

  it('combines the search with the Filter, using the linked rule of every list page', () => {
    // A division keeps all its departments; departments without a division need selecting.
    expect(search('', ['regulatory_drug_safety'])).toEqual(['sara'])
    expect(search('', [], ['qa'])).toEqual(['admin', 'reem'])
    expect(search('', [], ['qa', 'pv'])).toEqual(['admin', 'reem', 'sara'])
    // In a division with departments selected, only those (here its one department).
    expect(search('', ['regulatory_drug_safety'], ['pv'])).toEqual(['sara'])
    // A division and a department of another group: each counts in its own group.
    expect(search('', ['regulatory_drug_safety'], ['qa'])).toEqual(['admin', 'reem', 'sara'])
    expect(search('reem', [], ['qa'])).toEqual(['reem'])
    expect(search('sara', [], ['qa'])).toEqual([])
    // Nothing selected: everyone.
    expect(search('')).toEqual(['admin', 'reem', 'sara'])
  })

  it('says when no user matches', () => {
    expect(adminEn.usersList.empty).toBe('No staff found.')
  })
})

describe('the Delete Staff warning (it deactivates)', () => {
  it('asks "Delete {name}?" in the prominent layout, lists what happens, with Cancel first and Delete in the primary filled style', () => {
    const text = adminEn.deleteUser
    const html = renderToStaticMarkup(
      <ConfirmDialog open prominent title={text.title.replace('{name}', 'Sara Aljuraybah')} description={text.description}
        cancelLabel={text.cancel} confirmLabel={text.confirm} onConfirm={() => {}} onCancel={() => {}}>
        <ul>{text.consequences.map((line) => <li key={line}>{line}</li>)}</ul>
      </ConfirmDialog>,
    )
    // A larger title over smaller (14px) message text, all left-aligned.
    expect(html).toMatch(/<h2 id="[^"]+" class="text-left text-xl break-words sm:text-2xl">Delete Sara Aljuraybah\?<\/h2>/)
    expect(html).toMatch(/<div id="[^"]+" class="mt-3 text-left text-sm text-text-gray">/)
    expect(html).toContain('Deleting a staff member makes their account inactive. Nothing is permanently deleted.')
    for (const line of [
      'Their account status will change to Inactive.',
      'All of their staff information and historical records will be kept.',
      'They won’t be able to access Hawkim while their account is inactive.',
      'You can reactivate their account later from the Deactive Staff tab.',
    ]) expect(html).toContain(`<li>${line}</li>`)
    const cancel = html.match(/<button[^>]*>Cancel<\/button>/)![0]
    const remove = html.match(/<button[^>]*>Delete<\/button>/)![0]
    expect(cancel).toContain('autofocus')
    expect(html.indexOf('>Cancel<')).toBeLessThan(html.indexOf('>Delete<'))
    expect(remove).toContain('bg-maroon')
    expect(html).not.toMatch(/permanently removed|can.t be undone/i)
  })
})

describe('permission badges', () => {
  it('use the sidebar Admin tag\'s tokens with a lighter gold (60%) everywhere', () => {
    const tag = ['rounded-md', 'bg-gold-light/60', 'px-1.5', 'py-0.5', 'text-xs', 'font-semibold', 'text-maroon']
    const html = render()
    const badges = [...html.matchAll(/<li class="([^"]*)">([^<]+)<\/li>/g)]
    expect(badges.length).toBeGreaterThan(0)
    for (const [, classes] of badges) {
      for (const token of tag) expect(classes.split(' ')).toContain(token)
      expect(classes).not.toMatch(/border|rounded-full|px-2\.5/)
    }
  })

  it('show no badge for a user without a role', () => {
    expect(renderToStaticMarkup(<PermissionBadges user={{ permissions: [] }} />)).toBe('')
  })
})

describe('the Permission section of the Staff Filter', () => {
  const byPermission = (permissions: User['permissions'], divisions: string[] = [], departmentIds: string[] = []) =>
    filterUsers(fixture.users, getDepartment, { query: '', divisions, departmentIds, permissions }, usersEn.permissions).map((user) => user.id)

  it('comes after Department, with a chip per permission labelled as on the badges', () => {
    const html = render()
    expect([...html.matchAll(/<legend[^>]*>([^<]+)<\/legend>/g)].map((match) => match[1])).toEqual(['Division', 'Department', 'Permission'])
    expect(chips(html, 'Permission')).toEqual(['author', 'reviewer', 'approver', 'admin'].map((permission) => usersEn.permissions[permission as User['permissions'][number]]))
  })

  it('matches anyone with ANY chosen permission, AND the Division and Department filter', () => {
    expect(byPermission(['approver'])).toEqual(['reem'])
    expect(byPermission(['reviewer', 'approver'])).toEqual(['reem', 'sara'])
    expect(byPermission([])).toEqual(['admin', 'reem', 'sara'])
    // Approver in Regulatory and Drug Safety: Reem is an approver, but in Quality Assurance.
    expect(byPermission(['approver'], ['regulatory_drug_safety'])).toEqual([])
    expect(byPermission(['author', 'approver'], [], ['qa'])).toEqual(['reem'])
  })

  it('is read from the URL, summed up in the field, and cleared by Clear Filters', () => {
    const html = render('?permission=author,reviewer,gone')
    expect(chips(html, 'Permission')).toEqual(['Author ✓', 'Reviewer ✓', 'Approver', usersEn.permissions.admin])
    expect(rowCount(html)).toBe(1)
    expect(filterField(html)).toContain('aria-label="Filter: 2 permissions"')
    expect(filterField(render('?permission=approver'))).toContain('>1 permission</span>')
    expect(html).toContain('>Clear Filters<')
    // With a division: both apply (Sara is an author in Regulatory and Drug Safety).
    const both = render('?division=regulatory_drug_safety&permission=approver')
    expect(rowCount(both)).toBe(0)
    expect(both).toContain('>No staff found.<')
    expect(filterField(both)).toContain('>1 division, 1 permission</span>')
  })
})

describe('the Staff Sort', () => {
  const sorted = (sort?: StaffSort, query = '', divisions: string[] = [], departmentIds: string[] = []) =>
    filterUsers(fixture.users, getDepartment, { query, divisions, departmentIds, sort }, usersEn.permissions).map((user) => user.id)
  const rows = (html: string) => [...table(html).matchAll(/<th scope="row"[^>]*>[\s\S]*?>([A-Z][a-z]+ [A-Za-z]+)<\/[^>]+>/g)].map((match) => match[1])

  it('is the third column of the toolbar (Search | Filter | Sort), a dropdown like on Divisions and Departments', () => {
    const html = render()
    const order = ['name="search"', '>Filter</label>', 'name="staffSort"']
    expect(order.map((text) => html.indexOf(text)).every((index, i, all) => index > 0 && (i === 0 || index > all[i - 1]))).toBe(true)
    expect(html).toMatch(/>Sort<\/label>/)
    // The Filter panel lines up with the toolbar's right edge from lg, as on Divisions and Departments.
    expect(html).toContain('class="relative min-w-0 lg:static"')
    const select = html.match(/<select[^>]*name="staffSort"[^>]*>([\s\S]*?)<\/select>/)![1]
    expect([...select.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map((match) => [match[1], match[2]])).toEqual([
      ['default', 'Default order'],
      ['name-asc', 'A to Z'], ['name-desc', 'Z to A'],
      ['division-asc', 'A to Z'], ['division-desc', 'Z to A'],
      ['department-asc', 'A to Z'], ['department-desc', 'Z to A'],
    ])
    // No Permission sort (the Permission column and the Filter's Permission stay).
    expect(select).not.toContain('permission')
    // Closed, nothing chosen: Default order.
    expect(select).toMatch(/<option value="default"[^>]*selected="">Default order</)
    // Default order on its own, then a group per column, each with A to Z and Z to A.
    expect([...select.matchAll(/<optgroup label="([^"]+)">((?:(?!<\/optgroup>)[\s\S])*)<\/optgroup>/g)].map((match) => [match[1], [...match[2].matchAll(/value="([^"]+)"/g)].map((value) => value[1])]))
      .toEqual([
        ['Name', ['name-asc', 'name-desc']],
        ['Division', ['division-asc', 'division-desc']],
        ['Department', ['department-asc', 'department-desc']],
      ])
    expect(select.indexOf('value="default"')).toBeLessThan(select.indexOf('<optgroup'))
  })

  it('orders by name: Default order is A to Z (as before), or Z to A, after the search and the Filter', () => {
    expect(sorted()).toEqual(['admin', 'reem', 'sara'])
    expect(sorted('default')).toEqual(['admin', 'reem', 'sara'])
    expect(sorted('name-asc')).toEqual(['admin', 'reem', 'sara'])
    expect(sorted('name-desc')).toEqual(['sara', 'reem', 'admin'])
    expect(sorted('name-desc', 'a', [], ['qa', 'pv'])).toEqual(['sara', 'reem', 'admin'])
    expect(sorted('name-desc', '', [], ['qa'])).toEqual(['reem', 'admin'])
  })

  it('orders by division or department as shown, A to Z or Z to A; staff without one last, ties by name', () => {
    // Nouf and Reem are in Quality Assurance, which has no division; Sara is in Pharmacovigilance.
    expect(sorted('division-asc')).toEqual(['sara', 'admin', 'reem'])
    expect(sorted('division-desc')).toEqual(['sara', 'admin', 'reem'])
    expect(sorted('department-asc')).toEqual(['sara', 'admin', 'reem'])
    expect(sorted('department-desc')).toEqual(['admin', 'reem', 'sara'])
    expect(rows(render('?sort=department-desc'))).toEqual(['Reem Alharbi', 'Sara Aljuraybah'])
  })

  it('opens an old link with the removed Permission sort in Default order, without an error', () => {
    for (const old of ['permission-asc', 'permission-desc']) {
      const html = render(`?sort=${old}`)
      expect(rows(html)).toEqual(['Reem Alharbi', 'Sara Aljuraybah'])
      expect(html).toMatch(/<option value="default"[^>]*selected="">/)
    }
  })

  it('is read from the URL (?sort=name-asc or name-desc); none or an unknown value is Default order (A to Z)', () => {
    expect(rows(render())).toEqual(['Reem Alharbi', 'Sara Aljuraybah'])
    const desc = render('?sort=name-desc')
    expect(rows(desc)).toEqual(['Sara Aljuraybah', 'Reem Alharbi'])
    expect(desc).toMatch(/<option value="name-desc"[^>]*selected="">/)
    expect(rows(render('?sort=bogus'))).toEqual(['Reem Alharbi', 'Sara Aljuraybah'])
    expect(render('?sort=bogus')).toMatch(/<option value="default"[^>]*selected="">/)
    const asc = render('?sort=name-asc')
    expect(rows(asc)).toEqual(['Reem Alharbi', 'Sara Aljuraybah'])
    expect(asc).toMatch(/<option value="name-asc"[^>]*selected="">/)
    // With the Filter: still sorted, still filtered.
    expect(rows(render('?sort=name-desc&dept=qa,pv'))).toEqual(['Sara Aljuraybah', 'Reem Alharbi'])
  })

  it('is reset by Clear Filters, shown when only the sort differs from the default', () => {
    expect(render('?sort=name-desc')).toContain('>Clear Filters<')
    expect(render('?sort=name-asc')).toContain('>Clear Filters<')
    expect(render()).not.toContain('>Clear Filters<')
    expect(render('?sort=default')).not.toContain('>Clear Filters<')
    const cleared = clearedStaffParams(new URLSearchParams('division=x&dept=y&permission=author&sort=name-desc&other=1'))
    expect(cleared.toString()).toBe('other=1')
  })
})
