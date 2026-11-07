import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { usersEn } from '../content/users.en'
import type { User } from '../data/mock/types'
import {
  changesPermissions,
  deleteBlockers,
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
import { addUserAccount, fetchPeople, saveUser } from '../services/people'

/** What the admin entered, as a user's saved fields. */
function savedFields(input: NewUser, departmentId: string) {
  return {
    name: input.name.trim(),
    email: input.email.trim(),
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
 * Adding a user and changing their name, phone, position, department and permissions are saved on the
 * server. Their email and deleting them only change this tab's copy (lost on reload).
 * TODO: Save the other admin changes once those features are connected.
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
    async (input: NewUser) => {
      const problems = validateNewUser(input, latestRef.current.filter((user) => !user.deletedAt), departments)
      if (Object.values(problems).some(Boolean) || !input.departmentId) throw new Error('The user is not valid')
      const fields = savedFields(input, input.departmentId)
      const added = await addUserAccount({ name: fields.name, email: fields.email, phone: fields.phone, position: fields.position, departmentId: fields.departmentId, permissions: fields.permissions })
      // Someone re-added replaces their old entry.
      commit([...latestRef.current.filter((user) => user.id !== added.user.id), added.user])
      return added
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
      let initials = target.initials
      const changed = fields.name !== target.name || fields.phone !== target.phone || fields.position !== target.position
        || fields.departmentId !== target.departmentId || changesPermissions(target, fields.permissions)
      if (changed) {
        // First, so that a failure leaves everything as it was. The database's values are what a reload shows.
        const saved = await saveUser(
          userId,
          { name: fields.name, phone: fields.phone, position: fields.position, departmentId: fields.departmentId, permissions: fields.permissions },
          { departmentId: target.departmentId, permissions: target.permissions },
        )
        fields.name = saved.name
        fields.phone = saved.phone
        fields.position = saved.position
        fields.departmentId = saved.departmentId
        fields.permissions = saved.permissions
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
