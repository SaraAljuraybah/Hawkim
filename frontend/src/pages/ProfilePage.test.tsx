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

beforeEach(() => { fixture.home.divisionId = undefined })

describe('My Profile', () => {
  it('shows the user\'s own information from their home department, in one h1 page', () => {
    const html = render()
    for (const text of ['Name', 'Sara Aljuraybah', 'Email', 'sara@example.test', 'Department', 'Pharmacovigilance', 'Division', 'Roles', 'Author, Reviewer']) expect(html).toContain(`>${text}<`)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).not.toContain('Another Directory')
    expect(html).not.toContain('<input')
  })

  it('shows — without a division, and the division when configured', () => {
    expect(render()).toContain('>—<')
    fixture.home.divisionId = 'Safety'
    expect(render()).toContain('>Safety<')
  })

  it('offers Change Password, with live regions ready for the result', () => {
    const html = render()
    expect(html).toContain('>Change Password<')
    expect(html).toContain('role="status"')
    expect(html).toContain('role="alert"')
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

  it('keeps the department switcher outside the links, with no menu on the avatar', () => {
    expect(html()).toContain('>Department Switcher<')
    for (const link of links()) expect(link).not.toContain('<button')
    expect(html()).not.toContain('aria-haspopup="menu"')
  })
})
