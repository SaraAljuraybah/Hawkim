import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { User } from '../data/mock/types'
import { loadingEn } from '../content/loading.en'
import { systemEn } from '../content/system.en'
import type { SessionStatus } from '../state/sessionContext'
import type { LoadStatus } from '../state/useLoadAfterSignIn'
import { AdminArea, EmployeeArea } from './guards'

const state: { session: SessionStatus; user: User | null; users: LoadStatus; departments: LoadStatus } = {
  session: 'loading', user: null, users: 'loading', departments: 'loading',
}
vi.mock('../state/sessionContext', () => ({ useSession: () => ({ status: state.session, user: state.user }), useCurrentUser: () => state.user }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ status: state.users }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ status: state.departments }) }))

const sara: User = { id: 'uuid-sara', name: 'Sara Aljuraybah', email: 'sara.aljuraybah@hawkim.test', initials: 'SA', departmentId: 'information-technology', permissions: ['author'] }

const employee = () => renderToStaticMarkup(<MemoryRouter><EmployeeArea /></MemoryRouter>)
const admin = () => renderToStaticMarkup(<MemoryRouter><AdminArea /></MemoryRouter>)

beforeEach(() => Object.assign(state, { session: 'loading', user: null, users: 'loading', departments: 'loading' }))

describe('signed-in areas', () => {
  it('wait for the tab\'s session instead of sending the person to sign in', () => {
    expect(employee()).toContain(loadingEn.label)
    expect(admin()).toContain(loadingEn.label)
  })

  it('send someone who isn\'t signed in to the sign-in page', () => {
    state.session = 'signed-out'
    expect(employee()).not.toContain(loadingEn.label)
    expect(admin()).not.toContain(loadingEn.label)
  })

  it('wait for the people and departments after sign-in', () => {
    Object.assign(state, { session: 'signed-in', user: sara, users: 'ready', departments: 'loading' })
    expect(employee()).toContain(loadingEn.label)
  })

  it('say when the people or departments couldn\'t be loaded', () => {
    Object.assign(state, { session: 'signed-in', user: sara, users: 'error', departments: 'ready' })
    expect(employee()).toContain(systemEn.loadFailed.title.replace("'", '&#x27;'))
    expect(admin()).toContain(systemEn.loadFailed.retry)
  })
})
