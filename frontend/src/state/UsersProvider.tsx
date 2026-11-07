import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { usersEn } from '../content/users.en'
import type { User } from '../data/mock/types'
import {
  deleteBlockers,
  initialsOf,
  isDatabaseUser,
  NO_DIVISION,
  normalizePhone,
  PERMISSIONS,
  permissionChangeBlockers,
  validateNewUser,
  type NewUser,
} from '../lib/userAdmin'
import { useDepartments } from './departmentsContext'
import { useLoadAfterSignIn } from './useLoadAfterSignIn'
import { UsersContext, type AdminActionContext, type UsersStore } from './usersContext'
import { fetchPeople, updateUserDetails } from '../services/people'

/** What the admin entered, as a user's saved fields. */
function savedFields(input: NewUser, departmentId: string) {
  const name = input.name.trim()
  return {
    name,
    email: input.email.trim(),
    initials: initialsOf(name),
    departmentId,
    divisionId: input.divisionId && input.divisionId !== NO_DIVISION ? input.divisionId : undefined,
    phone: normalizePhone(input.phone) ?? '',
    position: input.position.trim(),
    // Kept in display order, without duplicates.
    permissions: PERMISSIONS.filter((permission) => input.permissions.includes(permission)),
  }
}

/**
 * Users store shared by the employee screens (names, people pickers) and the admin
 * portal. The people and their roles are loaded from the database after sign-in.
 * A user's name, phone and position are saved to the database (updateUser). The other admin
 * actions only change this tab's copy (lost on reload): a user added here has no sign-in
 * account. TODO: Save the other admin changes once those features are connected.
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

  const addUser = useCallback(
    (input: NewUser) => {
      const current = latestRef.current
      const problems = validateNewUser(input, current.filter((user) => !user.deletedAt), departments)
      if (Object.values(problems).some(Boolean) || !input.departmentId) throw new Error('The user is not valid')
      const created: User = {
        // Unique enough for an in-memory demo (the backend will assign real ids).
        id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        ...savedFields(input, input.departmentId),
      }
      commit([...current, created])
      return created
    },
    [commit, departments],
  )

  const updateUser = useCallback(
    async (userId: string, input: NewUser, context: AdminActionContext) => {
      const { target, rules } = resolve(userId, context)
      // The user's own email isn't a duplicate of itself.
      const problems = validateNewUser(input, rules.users.filter((user) => user.id !== userId), departments)
      if (Object.values(problems).some(Boolean) || !input.departmentId) throw new Error('The user is not valid')
      if (permissionChangeBlockers(target, input.permissions, rules).length > 0) {
        throw new Error('These permissions can’t be removed now')
      }
      const fields = savedFields(input, input.departmentId)
      // The initials only follow a new name.
      let initials = fields.name === target.name ? target.initials : fields.initials
      const detailsChanged = fields.name !== target.name || fields.phone !== target.phone || fields.position !== target.position
      if (detailsChanged && isDatabaseUser(target)) {
        // First, so that a failure leaves everything as it was. The database's values are what a reload shows.
        const saved = await updateUserDetails(userId, { name: fields.name, phone: fields.phone, position: fields.position })
        fields.name = saved.name
        fields.phone = saved.phone
        fields.position = saved.position
        initials = saved.initials
      }
      commit(latestRef.current.map((user) => (user.id === userId ? { ...user, ...fields, initials } : user)))
    },
    [commit, departments, resolve],
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
    () => ({ status, users, activeUsers, getUser, nameOf, addUser, updateUser, deleteUser }),
    [status, users, activeUsers, getUser, nameOf, addUser, updateUser, deleteUser],
  )

  return <UsersContext.Provider value={store}>{children}</UsersContext.Provider>
}
