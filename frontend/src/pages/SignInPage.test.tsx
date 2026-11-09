import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import type { User } from '../data/mock/types'
import { signInEn } from '../content/auth.en'
import { SignInPage } from './SignInPage'

const fixture = vi.hoisted(() => ({
  values: { email: '', password: '' }, user: undefined as unknown as User, signIn: vi.fn(), navigate: vi.fn(),
  authenticate: vi.fn(), setStatus: vi.fn(),
}))
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>()
  return { ...react,
    useState: (initial: unknown) => [typeof initial === 'object' && initial && 'email' in initial ? fixture.values : initial, initial === '' ? fixture.setStatus : vi.fn()],
    useRef: () => ({ current: null }),
  }
})
vi.mock('react-router-dom', async (original) => ({ ...await original<typeof import('react-router-dom')>(), useNavigate: () => fixture.navigate }))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../state/sessionContext', () => ({ useSession: () => ({ signIn: fixture.signIn }) }))
// Supabase Auth itself is a stand-in: no client, credentials or network are used.
vi.mock('../services/auth', () => ({ signIn: fixture.authenticate }))

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
  fixture.values = { email: '  sara.aljuraybah@hawkim.test ', password: 'the-password' }
  fixture.user = { id: 'uuid-sara', name: 'Sara Aljuraybah', email: 'sara.aljuraybah@hawkim.test', initials: 'SA', permissions: ['author'], departmentId: 'pharmacovigilance' }
  fixture.authenticate.mockReset().mockImplementation(async () => ({ ok: true, user: fixture.user }))
  fixture.signIn.mockClear(); fixture.navigate.mockClear(); fixture.setStatus.mockClear()
})

describe('sign-in with Supabase Auth', () => {
  it('checks the trimmed email and the password with Supabase Auth, then signs in the returned profile', async () => {
    await submit()
    expect(fixture.authenticate).toHaveBeenCalledWith('sara.aljuraybah@hawkim.test', 'the-password')
    expect(fixture.signIn).toHaveBeenCalledWith(fixture.user)
    expect(fixture.navigate).toHaveBeenCalledWith('/dashboard')
  })

  it('never signs anyone in when Supabase Auth refuses the credentials, and says why', async () => {
    fixture.authenticate.mockResolvedValue({ ok: false, reason: 'invalid-credentials' })
    await submit()
    expect(fixture.signIn).not.toHaveBeenCalled()
    expect(fixture.navigate).not.toHaveBeenCalled()
    expect(fixture.setStatus).toHaveBeenCalledWith(signInEn.results.invalidCredentials)
  })

  it('validates required fields before contacting Supabase, and routes Admin accounts separately', async () => {
    fixture.values.password = ''
    await submit()
    expect(fixture.authenticate).not.toHaveBeenCalled()
    expect(fixture.signIn).not.toHaveBeenCalled()
    fixture.values.password = 'the-password'
    fixture.user.permissions = ['admin']
    await submit()
    expect(fixture.navigate).toHaveBeenCalledWith('/admin')
  })
})
