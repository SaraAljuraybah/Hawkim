import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { AdminTopBar } from '../components/layout/AdminTopBar'
import { TopBar } from '../components/layout/TopBar'
import { adminEn } from '../content/admin.en'
import { appShellEn } from '../content/app.en'
import type { ReactNode } from 'react'
import type { Department, User } from '../data/mock/types'
import { isPathAllowed } from '../lib/departmentNavigation'
import { ADMIN_PROFILE_PATH, PROFILE_PATH, profilePathFor } from '../lib/routes'
import { ProfilePage } from './ProfilePage'
import { SuperAdminContext } from '../state/superAdminContext'

const fixture = vi.hoisted(() => ({
  user: { id: 'me', name: 'Sara Aljuraybah', initials: 'SA', email: 'sara@example.test', departmentId: 'home', permissions: ['author', 'reviewer'] } as User,
  home: { id: 'home', name: 'Pharmacovigilance', initials: 'PV', description: '' } as Department,
  titles: [] as string[],
}))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: (title: string) => { fixture.titles.push(title) } }))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.user }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ getDepartment: (id: string) => (id === fixture.home.id ? fixture.home : undefined) }) }))
vi.mock('../components/layout/NotificationsBell', () => ({ NotificationsBell: () => null, AdminNotificationsBell: () => <button type="button">Notifications</button> }))
vi.mock('../components/layout/DepartmentSwitcher', () => ({ DepartmentSwitcher: () => <button type="button">Department Switcher</button> }))

const render = () => renderToStaticMarkup(<MemoryRouter><ProfilePage /></MemoryRouter>)

beforeEach(() => {
  fixture.home.divisionId = undefined
  fixture.home.divisionName = undefined
  fixture.user = { ...fixture.user, phone: undefined, position: undefined, permissions: ['author', 'reviewer'] }
})

describe('My Profile', () => {
  it('shows the user\'s own information from their home department, in one h1 page', () => {
    const html = render()
    for (const text of ['Name', 'Sara Aljuraybah', 'Email', 'sara@example.test', 'Department', 'Pharmacovigilance', 'Division', 'Permission', 'Author, Reviewer']) expect(html).toContain(`>${text}<`)
    expect(html).not.toContain('Your Information')
    expect(html).not.toContain('>Role<')
    expect(html).not.toContain('>Roles<')
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).not.toContain('Another Directory')
    expect(html).not.toContain('<input')
  })

  it('lists the fields in the Add User order, then Password, with bold labels in the heading colour', () => {
    const html = render()
    const labels = [...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])
    expect(labels).toEqual(['Name', 'Email', 'Phone Number', 'Division', 'Department', 'Position', 'Permission', 'Password'])
    for (const dt of html.match(/<dt[^>]*>/g)!) {
      expect(dt).toContain('font-bold')
      expect(dt).toContain('text-maroon')
      expect(dt).not.toContain('text-text-gray')
    }
  })

  it('shows every empty value as the same —, blank text included', () => {
    fixture.user = { ...fixture.user, permissions: [], position: '   ' }
    const rows = [...render().matchAll(/<dt[^>]*>([^<]+)<\/dt>(<dd[^>]*>)([^<]*)<\/dd>/g)]
    const empty = rows.filter((match) => match[3] === '—')
    expect(empty.map((match) => match[1])).toEqual(['Phone Number', 'Division', 'Position', 'Permission'])
    expect(new Set(empty.map((match) => match[2])).size).toBe(1)
  })

  it('shows the phone number and position read-only, and — without them', () => {
    const value = (html: string, label: string) => html.match(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>([^<]*)<`))![1]
    expect(value(render(), 'Phone Number')).toBe('—')
    expect(value(render(), 'Position')).toBe('—')
    fixture.user = { ...fixture.user, phone: '+966500000001', position: 'Pharmacovigilance Specialist' }
    const html = render()
    expect(value(html, 'Phone Number')).toBe('+966500000001')
    expect(value(html, 'Position')).toBe('Pharmacovigilance Specialist')
    expect(html).not.toContain('<input')
  })

  it('shows — without a division, and the division\'s name when configured, never its id', () => {
    expect(render()).toContain('>—<')
    fixture.home.divisionId = 'regulatory_drug_safety'
    fixture.home.divisionName = 'Regulatory and Drug Safety'
    const html = render()
    expect(html).toContain('>Regulatory and Drug Safety<')
    expect(html).not.toContain('regulatory_drug_safety')
  })

  it('shows the password as a field-style box with hidden dots and a Change button named Change Password', () => {
    const html = render()
    const row = html.match(/<div class="([^"]*)"><dt[^>]*>Password<\/dt><dd[^>]*>(.*?)<\/dd><\/div>/)!
    expect(row[1]).toContain('border-t border-beige')
    const box = row[2]
    // The same look as the text inputs (controlClasses), but not an input.
    const boxClasses = box.match(/^<div class="([^"]*)"/)![1]
    for (const token of ['h-11', 'rounded-lg', 'border', 'bg-white', 'border-text-gray/70']) expect(boxClasses.split(' ')).toContain(token)
    expect(box).toContain('<span aria-hidden="true" class="tracking-widest">••••••••</span>')
    const button = box.match(/<button[^>]*>[^<]*<\/button>/)![0]
    expect(button).toMatch(/^<button type="button" aria-label="Change Password"/)
    expect(button).toMatch(/class="[^"]*text-maroon[^"]*hover:underline/)
    expect(button.match(/class="([^"]*)"/)![1].split(' ').some((token) => token.startsWith('bg-'))).toBe(false)
    expect(button).toContain('>Change</button>')
    expect(box).not.toContain('<input')
  })

  it('no longer offers the email link on the profile, and keeps the dialog closed at first', () => {
    const html = render()
    expect(html).not.toContain('We will email you')
    expect(html).not.toContain('Check your email')
    expect(html).not.toContain('role="alert"')
    expect(html).not.toMatch(/<h2[^>]*>/)
    expect(html).toContain('<dialog')
    expect(html).not.toContain('Current Password')
  })

  it('uses the full content width for the details card, but keeps the password box at a comfortable width', () => {
    const html = render()
    const card = html.match(/<div class="(rounded-xl border border-beige bg-white[^"]*)"><dl/)![1]
    expect(card).not.toMatch(/max-w-/)
    const box = html.match(/<dt[^>]*>Password<\/dt><dd[^>]*><div class="([^"]*)"/)![1]
    expect(box.split(' ')).toContain('max-w-md')
  })

  it('stays open while browsing a read-only department', () => {
    expect(isPathAllowed(PROFILE_PATH, true)).toBe(true)
  })
})

describe('top bar links to My Profile', () => {
  const html = () => renderToStaticMarkup(<MemoryRouter><TopBar content={appShellEn} user={fixture.user} menuOpen={false} onOpenMenu={() => {}} menuButtonRef={{ current: null }} /></MemoryRouter>)
  const links = () => html().match(/<a[^>]*href="\/profile"[^>]*>.*?<\/a>/g)!

  it('makes the avatar the one real link, named for assistive technology', () => {
    expect(links()).toHaveLength(2)
    expect(links()[0]).toContain('aria-label="My Profile, Sara Aljuraybah"')
    expect(links()[0]).not.toContain('tabindex')
    expect(links()[0]).toContain('>SA<')
  })

  it('adds the name as a pointer-only link, hidden from keyboard and screen reader users', () => {
    expect(links()[1]).toContain('tabindex="-1"')
    expect(links()[1]).toContain('aria-hidden="true"')
    expect(links()[1]).toContain('>Sara Aljuraybah<')
  })

  it('shows "Department | Position" under the name, the separator hidden from screen readers', () => {
    fixture.user = { ...fixture.user, position: 'Pharmacovigilance Specialist' }
    const markup = html()
    const line = markup.match(/<div class="hidden items-center[^"]*sm:flex">(.*?)<\/div>/)![1]
    expect(line).toBe('<span class="shrink-0"><button type="button">Department Switcher</button></span><span aria-hidden="true" class="shrink-0 text-text-gray/60">|</span><span class="min-w-0 break-words">Pharmacovigilance Specialist</span>')
    expect(markup.indexOf('Sara Aljuraybah<')).toBeLessThan(markup.indexOf('Pharmacovigilance Specialist'))
  })

  it('shows only the department without a position', () => {
    const line = html().match(/<div class="hidden items-center[^"]*sm:flex">(.*?)<\/div>/)![1]
    expect(line).toBe('<span class="shrink-0"><button type="button">Department Switcher</button></span>')
  })

  it('never truncates the user details, keeps Position | Department on one row, and hides them on phones', () => {
    fixture.user = { ...fixture.user, position: 'Pharmacovigilance Specialist' }
    const markup = html()
    const userArea = markup.slice(markup.indexOf('href="/profile"'))
    expect(userArea).not.toContain('truncate')
    // No fixed or maximum width on the user details.
    expect(userArea).not.toMatch(/[\s"](?:max-w-|w-)\S/)
    expect(markup).toContain('min-h-16')
    expect(links()[1]).toContain('hidden')
    expect(links()[1]).toContain('sm:block')
    // Side by side, never stacked: the row itself doesn't wrap.
    expect(markup).toMatch(/<div class="hidden items-center[^"]*sm:flex">/)
    expect(markup).not.toMatch(/<div class="hidden[^"]*flex-wrap[^"]*sm:flex">/)
  })

  it('shows no focus ring on the mouse-only name link, so nothing covers the department line; the avatar keeps its ring', () => {
    for (const position of [undefined, 'Pharmacovigilance Specialist']) {
      fixture.user = { ...fixture.user, position }
      const [avatar, name] = links()
      expect(name).toContain('tabindex="-1"')
      expect(name.match(/class="([^"]*)"/)![1].split(' ')).toContain('outline-none')
      // The avatar uses the site's visible keyboard focus ring.
      expect(avatar).not.toContain('outline-none')
      expect(avatar).not.toContain('tabindex')
    }
  })

  it('keeps the department switcher outside the links, with no menu on the avatar', () => {
    expect(html()).toContain('>Department Switcher<')
    for (const link of links()) expect(link).not.toContain('<button')
    expect(html()).not.toContain('aria-haspopup="menu"')
  })
})

describe('My Profile in the admin portal', () => {
  const admin = { ...fixture.user, name: 'Nouf Almutairi', initials: 'NA', permissions: ['admin'] } as User
  const page = () => renderToStaticMarkup(<MemoryRouter><ProfilePage admin /></MemoryRouter>)
  const value = (html: string, label: string) => html.match(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>([^<]*)<`))![1]

  beforeEach(() => { fixture.user = admin })

  it('shows no position, division or department (even if the account still holds them), in one h1 page, with Admin as the permission', () => {
    fixture.user = { ...admin, position: 'IT Manager' }
    const html = page()
    expect([...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])).toEqual(['Name', 'Email', 'Phone Number', 'Permission', 'Password'])
    expect(value(html, 'Permission')).toBe('Admin')
    expect(html).not.toContain('IT Manager')
    expect(html).not.toContain('Pharmacovigilance')
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Change Password"')
  })

  it('only differs in the browser tab title', () => {
    fixture.titles.length = 0
    page()
    expect(fixture.titles.at(-1)).toBe(adminEn.pageTitle.replace('{page}', 'My Profile'))
    const html = page()
    expect(html).toBe(renderToStaticMarkup(<MemoryRouter><ProfilePage /></MemoryRouter>))
  })

  it('is linked from the admin top bar: the avatar for everyone, the name for the mouse', () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminTopBar content={adminEn.shell} user={admin} menuOpen={false} onOpenMenu={() => {}} menuButtonRef={{ current: null }} /></MemoryRouter>)
    const links = html.match(/<a[^>]*href="\/admin\/profile"[^>]*>.*?<\/a>/g)!
    expect(links).toHaveLength(2)
    expect(links[0]).toContain('aria-label="My Profile, Nouf Almutairi"')
    expect(links[0]).not.toContain('tabindex')
    expect(links[0]).toContain('>NA<')
    expect(links[1]).toContain('tabindex="-1"')
    expect(links[1]).toContain('aria-hidden="true"')
    expect(links[1]).toContain('>Nouf Almutairi<')
    // The role under the name (Super Admin or Admin) needs the portal's shared state: see below.
  })

  const inPortal = (superAdminId: string | null, node: ReactNode, status: 'ready' | 'loading' | 'error' = 'ready') => renderToStaticMarkup(
    <SuperAdminContext.Provider value={{ status, superAdminId, reload: () => {}, set: () => {} }}><MemoryRouter>{node}</MemoryRouter></SuperAdminContext.Provider>,
  )
  const topBar = (user: User) => <AdminTopBar content={adminEn.shell} user={user} menuOpen={false} onOpenMenu={() => {}} menuButtonRef={{ current: null }} />

  it('shows only the role under the admin\'s name: an administrator has no position or department', () => {
    const html = inPortal('someone-else', topBar({ ...admin, position: 'IT Manager' }))
    expect(html).toContain('<p class="truncate text-xs text-text-gray">Admin</p>')
    expect(html).not.toContain('IT Manager')
  })

  it('shows "Super Admin" for the current Super Admin, in the top bar and as the permission', () => {
    expect(inPortal(admin.id, topBar(admin))).toContain('<p class="truncate text-xs text-text-gray">Super Admin</p>')
    expect(value(inPortal(admin.id, <ProfilePage admin />), 'Permission')).toBe('Super Admin')
    expect(value(inPortal('someone-else', <ProfilePage admin />), 'Permission')).toBe('Admin')
  })

  it('shows no role under the name until it is known who the Super Admin is', () => {
    for (const status of ['loading', 'error'] as const) {
      const html = inPortal(null, topBar(admin), status)
      expect(html).not.toContain('Super Admin')
      expect(html).not.toContain('<p class="truncate text-xs text-text-gray">')
    }
  })

  it('knows where each person\'s profile is', () => {
    expect(adminEn.shell.profileLink.href).toBe(ADMIN_PROFILE_PATH)
    expect(profilePathFor(admin)).toBe(ADMIN_PROFILE_PATH)
    expect(profilePathFor({ permissions: ['author'] })).toBe(PROFILE_PATH)
    expect(profilePathFor({ permissions: [] })).toBe(PROFILE_PATH)
    expect(profilePathFor(null)).toBe(PROFILE_PATH)
  })
})

describe('the email on My Profile', () => {
  it('has the copy button right after it', () => {
    const html = render()
    expect(html).toContain('<span class="min-w-0 break-all">sara@example.test</span>')
    expect(html).toContain('aria-label="Copy your email"')
  })
})
