import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usersEn } from '../content/users.en'
import type { Permission, User } from '../data/mock/types'
import {
  deleteBlockers,
  PERMISSIONS,
  permissionChangeBlockers,
  validateNewUser,
  type NewUser,
} from '../lib/userAdmin'
import { useDepartments } from './departmentsContext'
import { useLoadAfterSignIn } from './useLoadAfterSignIn'
import { UsersContext, type AdminActionContext, type UsersStore } from './usersContext'
import { fetchPeople } from '../services/people'
import { ORGANIZATION_CHANGED, organizationEvents } from '../services/organizationAdmin'
import { createUser, deleteUserAccount, setUserPermissions } from '../services/users'

/**
 * Users store shared by the employee screens (names, people pickers) and the admin
 * portal. The people and their roles are loaded from the database after sign-in.
 * The admin actions are saved through services/users.ts (database + Auth, admin only), then
 * the list is read back from the database, so nothing here is kept only in memory.
 * Must be inside <SessionProvider>.
 */
export function UsersProvider({ children }: { children: ReactNode }) {
  const { departments } = useDepartments()
  const [users, setUsers] = useState<User[]>([])
  // The latest list (as in the SOPs store): actions check against it, not the last render.
  const latestRef = useRef<User[]>(users)
  const commit = useCallback((next: User[]) => {
    latestRef.current = next
    setUsers(next)
  }, [])
  const status = useLoadAfterSignIn(fetchPeople, commit)

  const activeUsers = useMemo(() => users.filter((user) => !user.deletedAt), [users])
  const getUser = useCallback((id: string | undefined) => users.find((user) => user.id === id), [users])
  const nameOf = useCallback(
    (id: string | undefined) => {
      const user = users.find((item) => item.id === id)
      if (!user) return ''
      return user.deletedAt ? usersEn.deletedName.replace('{name}', user.name) : user.name
    },
    [users],
  )

  /** The admin and the active user being changed, from the latest list (throws if either isn't valid). */
  const resolve = useCallback((userId: string, context: AdminActionContext) => {
    const active = latestRef.current.filter((user) => !user.deletedAt)
    const actor = active.find((user) => user.id === context.actorId)
    if (!actor?.permissions.includes('admin')) throw new Error('Only an admin can manage users')
    const target = active.find((user) => user.id === userId)
    if (!target) throw new Error(`Unknown user ${userId}`)
    return { target, rules: { actorId: actor.id, users: active, sops: context.sops } }
  }, [])

  /** Reads everyone again from the database (after a saved change, here or in organization admin). */
  const reload = useCallback(async () => commit(await fetchPeople()), [commit])
  useEffect(() => {
    const refresh = () => { reload().catch(() => { /* keep the last list; the next load retries */ }) }
    organizationEvents.addEventListener(ORGANIZATION_CHANGED, refresh)
    return () => organizationEvents.removeEventListener(ORGANIZATION_CHANGED, refresh)
  }, [reload])

  const addUser = useCallback(
    async (input: NewUser) => {
      const problems = validateNewUser(input, latestRef.current.filter((user) => !user.deletedAt), departments)
      if (Object.values(problems).some(Boolean) || !input.departmentId) throw new Error('The user is not valid')
      // Saved by the database (with the Auth invitation); the list is then read back from it.
      const id = await createUser({
        name: input.name,
        email: input.email,
        phone: input.phone,
        departmentId: input.departmentId,
        positions: [input.position],
        // Kept in display order, without duplicates.
        permissions: PERMISSIONS.filter((permission) => input.permissions.includes(permission)),
      })
      await reload()
      const created = latestRef.current.find((user) => user.id === id)
      if (!created) throw new Error('The new user could not be loaded')
      return created
    },
    [departments, reload],
  )

  const updatePermissions = useCallback(
    async (userId: string, permissions: Permission[], context: AdminActionContext) => {
      const { target, rules } = resolve(userId, context)
      if (permissionChangeBlockers(target, permissions, rules).length > 0) {
        throw new Error('These permissions can’t be removed now')
      }
      await setUserPermissions(userId, PERMISSIONS.filter((permission) => permissions.includes(permission)))
      await reload()
    },
    [reload, resolve],
  )

  const deleteUser = useCallback(
    async (userId: string, context: AdminActionContext) => {
      const { target, rules } = resolve(userId, context)
      if (deleteBlockers(target, rules).length > 0) throw new Error('This user can’t be deleted now')
      await deleteUserAccount(userId)
      await reload()
    },
    [reload, resolve],
  )

  const store = useMemo<UsersStore>(
    () => ({ status, users, activeUsers, getUser, nameOf, addUser, updatePermissions, deleteUser }),
    [status, users, activeUsers, getUser, nameOf, addUser, updatePermissions, deleteUser],
  )

  return <UsersContext.Provider value={store}>{children}</UsersContext.Provider>
}
