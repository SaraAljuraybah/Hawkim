import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { TopBar } from '../components/layout/TopBar'
import { appShellEn } from '../content/app.en'
import type { Department, User } from '../data/mock/types'
import { isPathAllowed } from '../lib/departmentNavigation'
import { PROFILE_PATH } from '../lib/routes'
import { ProfilePage } from './ProfilePage'

const fixture = vi.hoisted(() => ({
  user: { id: 'me', name: 'Sara Aljuraybah', initials: 'SA', email: 'sara@example.test', departmentId: 'home', permissions: ['author', 'reviewer'] } as User,
  home: { id: 'home', name: 'Pharmacovigilance', initials: 'PV', description: '' } as Department,
}))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.user }))
vi.mock('../state/activeDepartmentContext', () => ({ useActiveDepartment: () => ({ homeDepartment: fixture.home, activeDepartment: { id: 'other', name: 'Another Directory' } }) }))
vi.mock('../components/layout/NotificationsBell', () => ({ NotificationsBell: () => null }))
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
    fixture.user = { ...fixture.user, permissions: ['admin'], position: '   ' }
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
    fixture.home.divisionName = 'Regulatory & Drug Safety'
    const html = render()
    expect(html).toContain('>Regulatory &amp; Drug Safety<')
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

  it('shows "Position | Department" under the name, the separator hidden from screen readers', () => {
    fixture.user = { ...fixture.user, position: 'Pharmacovigilance Specialist' }
    const markup = html()
    const line = markup.match(/<div class="hidden flex-wrap[^"]*sm:flex">(.*?)<\/div>/)![1]
    expect(line).toBe('<span class="min-w-0 break-words">Pharmacovigilance Specialist</span><span aria-hidden="true">|</span><button type="button">Department Switcher</button>')
    expect(markup.indexOf('Sara Aljuraybah<')).toBeLessThan(markup.indexOf('Pharmacovigilance Specialist'))
  })

  it('shows only the department without a position', () => {
    const line = html().match(/<div class="hidden flex-wrap[^"]*sm:flex">(.*?)<\/div>/)![1]
    expect(line).toBe('<button type="button">Department Switcher</button>')
  })

  it('never truncates the user details, lets them wrap, and keeps them hidden on phones', () => {
    fixture.user = { ...fixture.user, position: 'Pharmacovigilance Specialist' }
    const markup = html()
    const userArea = markup.slice(markup.indexOf('href="/profile"'))
    expect(userArea).not.toContain('truncate')
    // No fixed or maximum width on the user details.
    expect(userArea).not.toMatch(/[\s"](?:max-w-|w-)\S/)
    expect(markup).toContain('min-h-16')
    expect(links()[1]).toContain('hidden')
    expect(links()[1]).toContain('sm:block')
    expect(markup).toMatch(/<div class="hidden flex-wrap[^"]*sm:flex">/)
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
