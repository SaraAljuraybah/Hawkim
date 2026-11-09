import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { validateDetails } from '../../../supabase/functions/add-user/flow.ts'
import { changeUserEmail, ChangeEmailError, saveUser, toUser } from './people'

const rpc = vi.fn()
const invoke = vi.fn()
vi.mock('./supabase', () => ({ supabase: () => ({ rpc, functions: { invoke } }) }))
beforeEach(() => vi.clearAllMocks())

const httpError = (status: number, body: unknown) => new FunctionsHttpError(new Response(JSON.stringify(body), { status }))

describe('a department transfer refused by the database', () => {
  const changes = { name: 'Rana', phone: '+966512345678', position: 'Specialist', departmentId: 'it', permissions: ['author' as const] }

  it('is reported with the number of SOPs still in progress (only counts, never titles)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23514', hint: 'department-transfer-blocked', details: 'total:3,author:1,reviewer:2', message: 'x' } })
    await expect(saveUser('u', changes, { departmentId: 'qa', permissions: ['author'] })).rejects.toMatchObject({ reason: 'department-transfer-blocked', blockingSops: 3 })
  })

  it('still reports it when the details are missing', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23514', hint: 'department-transfer-blocked', details: null, message: 'x' } })
    await expect(saveUser('u', changes, { departmentId: 'qa', permissions: ['author'] })).rejects.toMatchObject({ reason: 'department-transfer-blocked', blockingSops: 0 })
  })

  it('explains a staff member left without a department', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23514', hint: 'department-required', message: 'x' } })
    await expect(saveUser('u', changes, { departmentId: null, permissions: ['admin'] })).rejects.toMatchObject({ reason: 'department-required' })
  })
})

describe('a System Admin', () => {
  it('is saved with no department or position, and the database keeps theirs', async () => {
    rpc.mockResolvedValue({ data: { name: 'Nouf', initials: 'NO', phone: '+966512345678', position: null, departmentId: null, permissions: ['admin'] }, error: null })
    const saved = await saveUser('u', { name: 'Nouf', phone: '+966512345678', position: null, departmentId: null, permissions: ['admin'] }, { departmentId: null, permissions: ['admin'] })
    expect(saved).toMatchObject({ position: null, departmentId: null, permissions: ['admin'] })
    expect(rpc).toHaveBeenCalledWith('save_user', expect.objectContaining({ p_department_id: null, p_position: null, p_expected_department_id: null }))
  })

  it('loads without a department', () => {
    const user = toUser({ id: 'u', full_name: 'Nouf', email: 'n@x.co', initials: 'NO', department_id: null, phone: '+966512345678', position: null, deleted_at: null, user_roles: [{ role: 'admin' }] })
    expect(user.departmentId).toBe('')
    expect(user).not.toHaveProperty('position')
  })

  it('is accepted by add-user without a department or position, which are never saved for them', () => {
    const admin = { name: 'Nouf', email: 'Nouf@X.co', phone: '+966512345678', permissions: ['admin'] }
    expect(validateDetails(admin)).toEqual({ name: 'Nouf', email: 'nouf@x.co', phone: '+966512345678', position: null, departmentId: null, permissions: ['admin'] })
    expect(validateDetails({ ...admin, position: 'IT', departmentId: 'qa' })).toMatchObject({ position: null, departmentId: null })
  })

  it('does not excuse staff from a department and position in add-user', () => {
    const staff = { name: 'Rana', email: 'r@x.co', phone: '+966512345678', permissions: ['author'] }
    expect(validateDetails(staff)).toBeUndefined()
    expect(validateDetails({ ...staff, position: 'Specialist' })).toBeUndefined()
    expect(validateDetails({ ...staff, position: 'Specialist', departmentId: 'qa' })).toMatchObject({ departmentId: 'qa' })
    expect(validateDetails({ ...staff, position: 'Specialist', departmentId: 'qa', phone: '0512345678' })).toBeUndefined()
  })
})

describe("changing a staff member's email", () => {
  it('goes through the update-user-email Edge Function, in lowercase', async () => {
    invoke.mockResolvedValue({ data: { userId: 'u', email: 'new@x.co' }, error: null })
    await expect(changeUserEmail('u', ' New@X.co ')).resolves.toBe('new@x.co')
    expect(invoke).toHaveBeenCalledWith('update-user-email', { body: { userId: 'u', email: 'new@x.co' } })
  })

  it.each([
    [httpError(409, { errorCode: 'email-taken' }), 'email-taken'],
    [httpError(404, { errorCode: 'not-found' }), 'not-found'],
    [httpError(502, { errorCode: 'account-failed' }), 'account-failed'],
    [httpError(401, {}), 'forbidden'],
    [httpError(403, { errorCode: 'forbidden' }), 'forbidden'],
    [httpError(500, { errorCode: 'something-else' }), 'failed'],
    [new FunctionsFetchError('offline'), 'failed'],
  ])('explains a refusal (%#)', async (error, reason) => {
    invoke.mockResolvedValue({ data: null, error })
    const refused = changeUserEmail('u', 'new@x.co')
    await expect(refused).rejects.toBeInstanceOf(ChangeEmailError)
    await expect(refused).rejects.toMatchObject({ reason })
  })

  it('reports an unexpected reply as failed', async () => {
    invoke.mockResolvedValue({ data: {}, error: null })
    await expect(changeUserEmail('u', 'new@x.co')).rejects.toMatchObject({ reason: 'failed' })
  })
})
