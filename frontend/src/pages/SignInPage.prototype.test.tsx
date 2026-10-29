import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import type { User } from '../data/mock/types'
import { SignInPage } from './SignInPage'

const fixture = vi.hoisted(() => ({
  values: { email: '', password: '' }, users: [] as User[], signIn: vi.fn(), navigate: vi.fn(),
}))
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>()
  return { ...react,
    useState: (initial: unknown) => [typeof initial === 'object' && initial && 'email' in initial ? fixture.values : initial, vi.fn()],
    useRef: () => ({ current: null }),
  }
})
vi.mock('react-router-dom', async (original) => ({ ...await original<typeof import('react-router-dom')>(), useNavigate: () => fixture.navigate }))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../state/sessionContext', () => ({ useSession: () => ({ signIn: fixture.signIn }) }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ activeUsers: fixture.users }) }))
vi.mock('../services/supabase', () => { throw new Error('Local sign-in must not load Supabase') })

function form(node: ReactNode): ReactElement<{ onSubmit: (event: unknown) => Promise<void> }> | undefined {
  if (Array.isArray(node)) return node.map(form).find(Boolean)
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined
  if (node.type === 'form') return node as ReactElement<{ onSubmit: (event: unknown) => Promise<void> }>
  return form(node.props.children)
}
async function submit() {
  const event = { preventDefault: vi.fn() }
  await form(SignInPage())!.props.onSubmit(event)
  expect(event.preventDefault).toHaveBeenCalled()
}
beforeEach(() => {
  fixture.values = { email: '  AUTHOR@hawkim.demo ', password: 'demo' }
  fixture.users = [{ id: 'author', name: 'Demo Author', email: 'author@hawkim.demo', initials: 'DA', permissions: ['author'], departmentId: 'home' }]
  fixture.signIn.mockClear(); fixture.navigate.mockClear()
})

describe('explicit local prototype sign-in', () => {
  it('selects the matching configured demo identity without a password service', async () => {
    await submit()
    expect(fixture.signIn).toHaveBeenCalledWith(fixture.users[0])
    expect(fixture.navigate).toHaveBeenCalledWith('/dashboard')
  })
  it('does not silently select a different user for an unknown email', async () => {
    fixture.values.email = 'unknown@hawkim.demo'
    await submit()
    expect(fixture.signIn).not.toHaveBeenCalled()
    expect(fixture.navigate).not.toHaveBeenCalled()
  })
  it('still validates required fields and routes existing Admin identities separately', async () => {
    fixture.values.password = ''
    await submit()
    expect(fixture.signIn).not.toHaveBeenCalled()
    fixture.values.password = 'demo'
    fixture.users[0].permissions = ['admin']
    await submit()
    expect(fixture.navigate).toHaveBeenCalledWith('/admin')
  })
})
