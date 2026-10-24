import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Button } from '../components/ui/Button'
import { dashboardEn } from '../content/app.en'
import type { Department, Permission, User } from '../data/mock/types'
import { DashboardPage } from './DashboardPage'

const fixture = vi.hoisted(() => ({
  user: { id: 'visitor', name: 'Visitor Test', initials: 'VT', email: 'v@example.test', departmentId: 'home', permissions: [] } as User,
  home: { id: 'home', name: 'Home Department', initials: 'HM', description: '' } as Department,
}))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.user }))
vi.mock('../state/activeDepartmentContext', () => ({ useActiveDepartment: () => ({
  activeDepartment: fixture.home, homeDepartment: fixture.home, directoryDepartments: [fixture.home], setActiveDepartment: vi.fn(),
}) }))
vi.mock('../state/requestsContext', () => ({ useMyRequests: () => [] }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: [] }) }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ users: [fixture.user] }) }))

const { primary, secondary } = dashboardEn.quickActions
const actionFor = (permission: Permission) => secondary.find((action) => [action.permission].flat().includes(permission))!
const upload = actionFor('author').label
const reviews = actionFor('reviewer').label

function render(page: ReactNode) {
  return renderToStaticMarkup(<MemoryRouter>{page}</MemoryRouter>)
}

/** Each quick action's link text and class, in order. */
function quickActions(permissions: Permission[]) {
  fixture.user.permissions = permissions
  const html = render(<DashboardPage />)
  const section = html.slice(html.indexOf('id="quick-actions-title"'))
  return [...section.matchAll(/<a [^>]*class="([^"]*)"[^>]*>(.*?)<\/a>/g)].map(([, className, inner]) => ({
    className,
    label: inner.replace(/<[^>]*>/g, ''),
  }))
}

/** The class of a default (primary) Button with the same props as the quick actions. */
const primaryClass = /class="([^"]*)"/.exec(render(<Button to="/x" withArrow className="w-full">x</Button>))![1]

describe('dashboard quick actions', () => {
  it.each<[Permission[], string[]]>([
    [[], [primary.label]],
    [['author'], [primary.label, upload]],
    [['reviewer'], [primary.label, reviews]],
    [['approver'], [primary.label, reviews]],
    [['author', 'reviewer'], [primary.label, upload, reviews]],
  ])('shows the actions %j allows, in order', (permissions, expected) => {
    expect(quickActions(permissions).map((action) => action.label)).toEqual(expected)
  })

  it.each<Permission[][]>([[[]], [['author']], [['reviewer']], [['approver']], [['author', 'reviewer']]])(
    'uses the filled (primary) style for every action for %j',
    (permissions) => {
      for (const action of quickActions(permissions)) expect(action.className, action.label).toBe(primaryClass)
    },
  )
})
