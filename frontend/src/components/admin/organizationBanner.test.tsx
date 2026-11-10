import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { OrganizationBanner, OrganizationNameForm } from './OrganizationBanner'
import { AdminTopBar } from '../layout/AdminTopBar'
import { TopBar } from '../layout/TopBar'
import { adminEn } from '../../content/admin.en'
import { appShellEn } from '../../content/app.en'
import { isOrganizationNameEditPage } from '../../lib/routes'
import type { User } from '../../data/mock/types'
import { fetchOrganizationName, organizationNameProblem, saveOrganizationName } from '../../services/organizationSettings'
import { SuperAdminContext } from '../../state/superAdminContext'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../services/supabase', () => ({ supabase: () => ({ rpc }) }))
const org = vi.hoisted(() => ({ status: 'ready', name: null as string | null }))
vi.mock('../../hooks/useOrganizationName', () => ({ useOrganizationName: () => ({ ...org, set: () => {} }) }))
// The staff top bar's own parts, which need the signed-in app's state.
vi.mock('../layout/NotificationsBell', () => ({ NotificationsBell: () => <button type="button">Notifications</button> }))
vi.mock('../layout/DepartmentSwitcher', () => ({ DepartmentSwitcher: () => <button type="button">Department Switcher</button> }))

const banner = (name: string | null, canEdit: boolean) => renderToStaticMarkup(<OrganizationBanner name={name} canEdit={canEdit} onEdit={vi.fn()} />)

describe('the organization banner', () => {
  it('fits the top bar: a ~36px pill circle, the name in maroon (semibold, text-lg) with a thin gold line, no heading', () => {
    const html = banner('Riyadh Pharma', false)
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*size-9[^"]*rounded-full bg-maroon text-offwhite[^"]*"><svg[^>]*lucide-pill/)
    expect(html).toContain('font-semibold text-maroon sm:text-lg')
    expect(html).toContain('<span aria-hidden="true" class="mt-1 block h-0.5 w-12 max-w-full rounded-full bg-gold"></span>')
    expect(html).not.toMatch(/<h[1-6]/)
    // Gold is only the line: never on text.
    expect(html).not.toContain('text-gold')
  })

  it('cuts a long name with "…", keeping the full name in the tooltip and for screen readers', () => {
    const long = 'Saudi Pharmaceutical Industries and Medical Appliances Corporation, Riyadh Branch'
    const html = banner(long, false)
    expect(html).toContain(`<p title="${long}" class="truncate `)
    expect(html).toContain(`<span class="sr-only">Organization: </span>${long}</p>`)
    // It shrinks instead of pushing what is beside it.
    expect(html).toMatch(/^<div class="flex min-w-0 items-center/)
  })

  it('hides the icon on phones, so the name keeps room', () => {
    expect(banner('Riyadh Pharma', false)).toContain('class="hidden size-9 shrink-0 items-center justify-center rounded-full bg-maroon text-offwhite sm:inline-flex"')
  })

  it('has the pencil only for the Super Admin', () => {
    expect(banner('Riyadh Pharma', false)).not.toContain('Edit organization name')
    const editable = banner('Riyadh Pharma', true)
    expect(editable).toContain('aria-label="Edit organization name"')
    expect(editable).toContain('lucide-pencil')
  })

  it('without a name: "Organization name not set" with the pencil for the Super Admin, nothing for anyone else', () => {
    const html = banner(null, true)
    expect(html).toContain('<p class="truncate text-sm leading-tight text-text-gray">Organization name not set</p>')
    expect(html).toContain('aria-label="Edit organization name"')
    expect(banner(null, false)).toBe('')
    expect(banner('', false)).toBe('')
  })
})

describe('the Edit Organization Name dialog', () => {
  it('has one required field filled in with the current name, Save Changes and Cancel', () => {
    const html = renderToStaticMarkup(<OrganizationNameForm name="Riyadh Pharma" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(html).toContain('Edit Organization Name')
    expect([...html.matchAll(/<input[^>]*name="([^"]+)"/g)].map((match) => match[1])).toEqual(['organizationName'])
    expect(html).toMatch(/<input[^>]*required=""[^>]*value="Riyadh Pharma"|<input[^>]*value="Riyadh Pharma"[^>]*required=""/)
    expect(html).toContain('>Organization Name')
    expect(html).toContain('>Save Changes<')
    expect(html).toContain('>Cancel<')
  })

  it('starts empty when no name is saved', () => {
    const html = renderToStaticMarkup(<OrganizationNameForm name={null} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(html).toMatch(/<input[^>]*name="organizationName"[^>]*value=""/)
  })

  it('needs a name of 1 to 200 characters, ignoring spaces at either end', () => {
    expect(organizationNameProblem('')).toBe('required')
    expect(organizationNameProblem('   ')).toBe('required')
    expect(organizationNameProblem('x'.repeat(201))).toBe('tooLong')
    expect(organizationNameProblem(`  ${'x'.repeat(200)}  `)).toBeUndefined()
    expect(organizationNameProblem(' Riyadh Pharma ')).toBeUndefined()
  })
})

describe('the organization name service', () => {
  beforeEach(() => rpc.mockReset())

  it('reads the name, or null when none is saved', async () => {
    rpc.mockResolvedValueOnce({ data: 'Riyadh Pharma', error: null })
    expect(await fetchOrganizationName()).toBe('Riyadh Pharma')
    expect(rpc).toHaveBeenLastCalledWith('get_organization_name')
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await fetchOrganizationName()).toBeNull()
    rpc.mockResolvedValueOnce({ data: 42, error: null })
    await expect(fetchOrganizationName()).rejects.toThrow('Check your connection and try again.')
  })

  it('saves the name and says what to do when the server refuses', async () => {
    rpc.mockResolvedValueOnce({ data: 'Riyadh Pharma', error: null })
    expect(await saveOrganizationName('Riyadh Pharma')).toBe('Riyadh Pharma')
    expect(rpc).toHaveBeenLastCalledWith('set_organization_name', { p_name: 'Riyadh Pharma' })
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    await expect(saveOrganizationName('X')).rejects.toThrow('Only the Super Admin can change the organization name. Refresh the page.')
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023' } })
    await expect(saveOrganizationName('X')).rejects.toThrow('Enter a name of 1 to 200 characters.')
    rpc.mockResolvedValueOnce({ data: null, error: { code: '08006' } })
    await expect(saveOrganizationName('X')).rejects.toThrow('Check your connection and try again.')
  })
})

const nouf: User = { id: 'nouf', name: 'Nouf Almutairi', email: 'nouf@example.test', initials: 'NA', departmentId: '', permissions: ['admin'] }
const sara: User = { id: 'sara', name: 'Sara Aljuraybah', email: 'sara@example.test', initials: 'SA', departmentId: 'pv', position: 'Specialist', permissions: ['author'] }
const DIVISIONS_AND_DEPARTMENTS = '/admin/departments'
const adminBar = (superAdminId: string | null, path = '/admin/users', status: 'ready' | 'loading' | 'error' = 'ready') => renderToStaticMarkup(
  <SuperAdminContext.Provider value={{ status, superAdminId, reload: () => {}, set: () => {} }}>
    <MemoryRouter initialEntries={[path]}><AdminTopBar content={adminEn.shell} user={nouf} menuOpen={false} onOpenMenu={() => {}} menuButtonRef={{ current: null }} /></MemoryRouter>
  </SuperAdminContext.Provider>,
)
const staffBar = (user: User = sara, path = '/dashboard') => renderToStaticMarkup(
  <MemoryRouter initialEntries={[path]}><TopBar content={appShellEn} user={user} menuOpen={false} onOpenMenu={() => {}} menuButtonRef={{ current: null }} /></MemoryRouter>,
)

describe('the organization name in the admin top bar', () => {
  beforeEach(() => { org.status = 'ready'; org.name = 'Riyadh Pharma' })

  it('sits on the left, after the menu button and before the profile, taking only the space left over', () => {
    const html = adminBar('someone-else')
    const menu = html.indexOf('aria-label="Open menu"')
    const name = html.indexOf('Riyadh Pharma')
    const profile = html.indexOf('href="/admin/profile"')
    expect(menu).toBeGreaterThan(-1)
    expect(menu).toBeLessThan(name)
    expect(name).toBeLessThan(profile)
    expect(html).toContain('<div class="flex min-w-0 flex-1 items-center">')
    expect(html).toMatch(/<button type="button" aria-label="Open menu"[^>]*class="inline-flex size-10 shrink-0 /)
    expect(html).toContain('<div class="flex shrink-0 items-center gap-3">')
  })

  it('on phones keeps only the avatar (with its accessible name); from sm the name and role, cut with "…"', () => {
    const html = adminBar('nouf')
    expect(html).toContain('<div class="hidden max-w-48 min-w-0 leading-tight sm:block">')
    expect(html).toContain('aria-label="My Profile, Nouf Almutairi"')
    expect(html).toContain('class="block truncate text-sm font-medium')
    expect(html).toContain('<p class="truncate text-xs text-text-gray">Super Admin</p>')
  })

  it('has the pencil only for the Super Admin, and only on Divisions and Departments', () => {
    expect(adminBar('nouf', DIVISIONS_AND_DEPARTMENTS)).toContain('aria-label="Edit organization name"')
    expect(adminBar('nouf', `${DIVISIONS_AND_DEPARTMENTS}/`)).toContain('aria-label="Edit organization name"')
    // Read-only everywhere else, the Super Admin included (a department's page too).
    for (const path of ['/admin/users', '/admin/admins', '/admin/sops', `${DIVISIONS_AND_DEPARTMENTS}/quality-assurance`, '/admin/profile']) {
      const html = adminBar('nouf', path)
      expect(html).toContain('Riyadh Pharma')
      expect(html).not.toContain('Edit organization name')
    }
    // Other Admins, and while it isn't known who the Super Admin is: never.
    expect(adminBar('someone-else', DIVISIONS_AND_DEPARTMENTS)).not.toContain('Edit organization name')
    expect(adminBar('nouf', DIVISIONS_AND_DEPARTMENTS, 'loading')).not.toContain('Edit organization name')
    expect(adminBar('nouf', DIVISIONS_AND_DEPARTMENTS, 'error')).not.toContain('Edit organization name')
  })

  it('without a name: "Organization name not set" only for the Super Admin on Divisions and Departments; nothing elsewhere', () => {
    org.name = null
    expect(adminBar('nouf', DIVISIONS_AND_DEPARTMENTS)).toContain('Organization name not set')
    for (const html of [adminBar('nouf', '/admin/users'), adminBar('someone-else', DIVISIONS_AND_DEPARTMENTS)]) {
      expect(html).not.toContain('Organization name not set')
      expect(html).not.toContain('lucide-pill')
    }
  })

  it('shows nothing while the name is loading or if it cannot be read; the profile is still there', () => {
    for (const status of ['loading', 'error']) {
      org.status = status
      const html = adminBar('nouf', DIVISIONS_AND_DEPARTMENTS)
      expect(html).not.toContain('lucide-pill')
      expect(html).not.toContain('Organization name not set')
      expect(html).toContain('aria-label="My Profile, Nouf Almutairi"')
    }
  })

  it('is edited only on the Divisions and Departments page itself', () => {
    expect(isOrganizationNameEditPage('/admin/departments')).toBe(true)
    expect(isOrganizationNameEditPage('/admin/departments/')).toBe(true)
    expect(isOrganizationNameEditPage('/admin/departments/new')).toBe(false)
    expect(isOrganizationNameEditPage('/admin/departments/quality-assurance')).toBe(false)
    expect(isOrganizationNameEditPage('/admin/users')).toBe(false)
    expect(isOrganizationNameEditPage('/organizational-structure')).toBe(false)
  })
})

describe('the organization name in the staff top bar', () => {
  beforeEach(() => { org.status = 'ready'; org.name = 'Riyadh Pharma' })

  it('is shown to every user, read-only, with the same component as the admin top bar', () => {
    const html = staffBar()
    expect(html).toContain('<span class="sr-only">Organization: </span>Riyadh Pharma</p>')
    expect(html).toContain('lucide-pill')
    expect(html).toContain('mt-1 block h-0.5 w-12 max-w-full rounded-full bg-gold')
    expect(html).not.toContain('Edit organization name')
  })

  it('sits after the menu button and before the notifications, the department switcher and the profile, in the space left over', () => {
    const html = staffBar()
    const order = ['aria-label="Open menu"', 'Riyadh Pharma', '>Notifications<', 'aria-label="My Profile, Sara Aljuraybah"', '>Department Switcher<']
    const at = order.map((text) => html.indexOf(text))
    expect(at.every((index) => index > -1)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(html).toContain('<div class="flex min-w-0 flex-1 items-center"><div class="flex min-w-0 items-center')
    expect(html).toMatch(/<button type="button" aria-label="Open menu"[^>]*class="[^"]*shrink-0 lg:hidden"/)
  })

  it('on phones keeps only the avatar: the name and the department line are hidden below sm', () => {
    const html = staffBar()
    expect(html).toContain('aria-label="My Profile, Sara Aljuraybah"')
    expect(html).toMatch(/class="hidden text-sm font-medium[^"]*sm:block"[^>]*>Sara Aljuraybah</)
    expect(html).toContain('<div class="hidden items-center gap-x-1.5 text-xs text-text-gray sm:flex">')
  })

  it('is never editable here, even with no name: then nothing is shown', () => {
    org.name = null
    for (const path of ['/dashboard', '/admin/departments']) {
      const html = staffBar(sara, path)
      expect(html).not.toContain('Organization name not set')
      expect(html).not.toContain('lucide-pill')
    }
  })
})
