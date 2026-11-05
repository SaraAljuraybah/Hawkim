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
vi.mock('../services/auth', () => ({ sendPasswordResetEmail: vi.fn() }))
vi.mock('../components/layout/NotificationsBell', () => ({ NotificationsBell: () => null }))
vi.mock('../components/layout/DepartmentSwitcher', () => ({ DepartmentSwitcher: () => <button type="button">Department Switcher</button> }))

const render = () => renderToStaticMarkup(<MemoryRouter><ProfilePage /></MemoryRouter>)

beforeEach(() => {
  fixture.home.divisionId = undefined
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

  it('shows — without a division, and the division when configured', () => {
    expect(render()).toContain('>—<')
    fixture.home.divisionId = 'Safety'
    expect(render()).toContain('>Safety<')
  })

  it('offers Change Password in the last row, under a divider, as a text-style button with a lock icon', () => {
    const html = render()
    const row = html.match(/<div class="([^"]*)"><dt[^>]*>Password<\/dt><dd[^>]*>(.*?)<\/dd><\/div>/)!
    expect(row[1]).toContain('border-t border-beige')
    const button = row[2]
    expect(button).toMatch(/^<button type="button"/)
    expect(button).toMatch(/class="[^"]*text-maroon[^"]*hover:underline/)
    expect(button).not.toMatch(/class="[^"]*\bbg-/)
    const icon = button.match(/<svg[^>]*>/)![0]
    expect(icon).toContain('lucide-lock')
    expect(icon).toContain('aria-hidden="true"')
    // The icon is hidden, so the accessible name is the text alone.
    expect(button.replace(/<svg.*?<\/svg>/g, '').replace(/<[^>]+>/g, '')).toBe('Change Password')
  })

  it('drops the separate Password card and its sentence', () => {
    const html = render()
    expect(html).not.toContain('We will email you')
    expect(html).not.toMatch(/<h2[^>]*>Password</)
    expect(html.match(/<section|<h2/g) ?? []).toHaveLength(0)
  })

  it('keeps the live regions for the result right under the Password row, in the same card', () => {
    const html = render()
    const after = html.slice(html.indexOf('>Change Password<'))
    expect(after).toMatch(/^>Change Password<\/button><\/dd><\/div><\/dl><div role="status"><\/div><div role="alert"><\/div>/)
    expect(html).not.toContain('Check your email')
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

  it('keeps the department switcher outside the links, with no menu on the avatar', () => {
    expect(html()).toContain('>Department Switcher<')
    for (const link of links()) expect(link).not.toContain('<button')
    expect(html()).not.toContain('aria-haspopup="menu"')
  })
})
