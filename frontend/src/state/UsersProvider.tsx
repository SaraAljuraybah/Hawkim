import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { usersEn } from '../content/users.en'
import { sampleUsers } from '../data/mock/users'
import type { Permission, User } from '../data/mock/types'
import {
  deleteBlockers,
  initialsOf,
  PERMISSIONS,
  permissionChangeBlockers,
  validateNewUser,
  type NewUser,
} from '../lib/userAdmin'
import { UsersContext, type AdminActionContext, type UsersStore } from './usersContext'

/**
 * In-memory users store shared by the employee screens (names, people pickers),
 * sign-in and the admin portal, so admin changes show everywhere at once.
 * Starts with the sample users; changes are lost on reload.
 * TODO: Replace with API calls once the backend exists.
 */
export function UsersProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>(sampleUsers)
  // The latest list (as in the SOPs store): actions check against it, not the last render.
  const latestRef = useRef<User[]>(sampleUsers)
  const commit = useCallback((next: User[]) => {
    latestRef.current = next
    setUsers(next)
  }, [])

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

  const addUser = useCallback(
    (input: NewUser) => {
      const current = latestRef.current
      const problems = validateNewUser(input, current.filter((user) => !user.deletedAt))
      if (Object.values(problems).some(Boolean) || !input.departmentId) throw new Error('The user is not valid')
      const name = input.name.trim()
      const created: User = {
        // Unique enough for an in-memory demo (the backend will assign real ids).
        id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        email: input.email.trim(),
        initials: initialsOf(name),
        departmentId: input.departmentId,
        // Kept in display order, without duplicates.
        permissions: PERMISSIONS.filter((permission) => input.permissions.includes(permission)),
      }
      commit([...current, created])
      return created
    },
    [commit],
  )

  const updatePermissions = useCallback(
    (userId: string, permissions: Permission[], context: AdminActionContext) => {
      const { target, rules } = resolve(userId, context)
      if (permissionChangeBlockers(target, permissions, rules).length > 0) {
        throw new Error('These permissions can’t be removed now')
      }
      const next = PERMISSIONS.filter((permission) => permissions.includes(permission))
      commit(latestRef.current.map((user) => (user.id === userId ? { ...user, permissions: next } : user)))
    },
    [commit, resolve],
  )

  const deleteUser = useCallback(
    (userId: string, context: AdminActionContext) => {
      const { target, rules } = resolve(userId, context)
      if (deleteBlockers(target, rules).length > 0) throw new Error('This user can’t be deleted now')
      const deletedAt = new Date().toISOString()
      commit(latestRef.current.map((user) => (user.id === userId ? { ...user, deletedAt } : user)))
    },
    [commit, resolve],
  )

  const store = useMemo<UsersStore>(
    () => ({ users, activeUsers, getUser, nameOf, addUser, updatePermissions, deleteUser }),
    [users, activeUsers, getUser, nameOf, addUser, updatePermissions, deleteUser],
  )

  return <UsersContext.Provider value={store}>{children}</UsersContext.Provider>
}
