import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { UserMenu } from '../components/layout/UserMenu'
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

  it('stays open while browsing a read-only department', () => {
    expect(isPathAllowed(PROFILE_PATH, true)).toBe(true)
  })
})

describe('avatar menu', () => {
  it('is a labelled menu button showing the initials, closed until used', () => {
    const html = renderToStaticMarkup(<MemoryRouter><UserMenu content={appShellEn.userMenu} user={fixture.user} /></MemoryRouter>)
    const button = html.match(/<button[^>]*>/)![0]
    expect(button).toContain('aria-label="User Menu for Sara Aljuraybah"')
    expect(button).toContain('aria-haspopup="menu"')
    expect(button).toContain('aria-expanded="false"')
    expect(html).toContain('>SA<')
    expect(html).not.toContain('role="menu"')
  })
})
