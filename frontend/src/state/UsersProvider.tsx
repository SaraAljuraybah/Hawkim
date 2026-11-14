import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { usersEn } from '../content/users.en'
import type { User } from '../data/mock/types'
import {
  changesPermissions,
  deleteBlockers,
  isSystemAdmin,
  NO_DIVISION,
  normalizePhone,
  PERMISSIONS,
  permissionChangeBlockers,
  validateNewUser,
  type NewUser,
} from '../lib/userAdmin'
import { useDepartments } from './departmentsContext'
import { useLoadAfterSignIn } from './useLoadAfterSignIn'
import { UsersContext, type AdminActionContext, type AdminDetails, type UsersStore } from './usersContext'
import { addUserAccount, changeUserEmail, deactivateStaff, fetchPeople, reactivateStaff, saveUser } from '../services/people'
import { AdminActionError, deleteAdminAccount, updateAdminDetails } from '../services/admins'

/** What the admin entered, as a user's saved fields. A System Admin has no department or position. */
function savedFields(input: NewUser, departmentId: string) {
  const systemAdmin = isSystemAdmin(input)
  return {
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    departmentId: systemAdmin ? '' : departmentId,
    divisionId: !systemAdmin && input.divisionId && input.divisionId !== NO_DIVISION ? input.divisionId : undefined,
    phone: normalizePhone(input.phone) ?? '',
    position: systemAdmin ? '' : input.position.trim(),
    // Kept in display order, without duplicates.
    permissions: PERMISSIONS.filter((permission) => input.permissions.includes(permission)),
  }
}

/**
 * Users store shared by the employee screens (names, people pickers) and the admin
 * portal. The people and their roles are loaded from the database after sign-in.
 * Adding, editing, deleting (deactivating) and reactivating staff, and the Admin actions, are saved on the
 * server first; this copy changes only once the database has done it.
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

  /**
   * The admin and the user being changed, from the latest list (throws if either isn't valid). The user must
   * be active, unless `deactivatedStaff` allows a deactivated staff member (Edit Staff on the Deactive Staff tab).
   */
  const resolve = useCallback((userId: string, context: AdminActionContext, deactivatedStaff = false) => {
    const active = latestRef.current.filter((user) => !user.deletedAt)
    const actor = active.find((user) => user.id === context.actorId)
    if (!actor?.permissions.includes('admin')) throw new Error('Only an admin can manage users')
    const target = latestRef.current.find((user) => user.id === userId && (!user.deletedAt || (deactivatedStaff && !isSystemAdmin(user))))
    if (!target) throw new Error(`Unknown user ${userId}`)
    return { target, rules: { actorId: actor.id, users: active, sops: context.sops } }
  }, [])

  const addUser = useCallback(
    async (input: NewUser) => {
      const problems = validateNewUser(input, latestRef.current.filter((user) => !user.deletedAt), departments)
      if (Object.values(problems).some(Boolean) || (!isSystemAdmin(input) && !input.departmentId)) throw new Error('The user is not valid')
      const fields = savedFields(input, input.departmentId)
      const added = await addUserAccount({ name: fields.name, email: fields.email, phone: fields.phone,
        position: fields.position || null, departmentId: fields.departmentId || null, permissions: fields.permissions })
      // Someone re-added replaces their old entry.
      commit([...latestRef.current.filter((user) => user.id !== added.user.id), added.user])
      return added
    },
    [commit, departments],
  )

  const updateUser = useCallback(
    async (userId: string, input: NewUser, context: AdminActionContext) => {
      const { target, rules } = resolve(userId, context, true)
      // The user's own email isn't a duplicate of itself.
      const problems = validateNewUser(input, rules.users.filter((user) => user.id !== userId), departments)
      const systemAdmin = isSystemAdmin(input)
      if (Object.values(problems).some(Boolean) || (!systemAdmin && !input.departmentId)) throw new Error('The user is not valid')
      if (permissionChangeBlockers(target, input.permissions, rules).length > 0) {
        throw new Error('These permissions can’t be removed now')
      }
      const fields = savedFields(input, input.departmentId)
      // A System Admin's department and position stay as the database has them.
      if (systemAdmin) {
        fields.departmentId = target.departmentId
        fields.position = target.position ?? ''
      }
      let initials = target.initials
      const changed = fields.name !== target.name || fields.phone !== target.phone || fields.position !== (target.position ?? '')
        || fields.departmentId !== target.departmentId || changesPermissions(target, fields.permissions)
      if (changed) {
        // First, so that a failure leaves everything as it was. The database's values are what a reload shows.
        const saved = await saveUser(
          userId,
          { name: fields.name, phone: fields.phone, position: systemAdmin ? null : fields.position,
            departmentId: systemAdmin ? null : fields.departmentId, permissions: fields.permissions },
          { departmentId: target.departmentId || null, permissions: target.permissions },
        )
        fields.name = saved.name
        fields.phone = saved.phone
        fields.position = saved.position ?? ''
        fields.departmentId = saved.departmentId ?? ''
        fields.permissions = saved.permissions
        initials = saved.initials
      }
      const { email, ...details } = fields
      // A System Admin has no position: none is kept.
      commit(latestRef.current.map((user) => (user.id === userId ? { ...user, ...details, initials, position: details.position || undefined } : user)))
      // Then the email, through the Edge Function that changes the sign-in account too. If it is
      // refused, the details above stay saved and the ChangeEmailError explains why.
      if (email !== target.email.toLowerCase()) {
        const savedEmail = await changeUserEmail(userId, email)
        commit(latestRef.current.map((user) => (user.id === userId ? { ...user, email: savedEmail } : user)))
      }
    },
    [commit, departments, resolve],
  )

  const deleteUser = useCallback(
    async (userId: string, context: AdminActionContext) => {
      const { target, rules } = resolve(userId, context)
      if (deleteBlockers(target, rules).length > 0) throw new Error('This user can’t be deactivated now')
      // The server first: the list changes only once the database has deactivated them.
      const { deactivatedAt } = await deactivateStaff(userId)
      commit(latestRef.current.map((user) => (user.id === userId ? { ...user, deletedAt: deactivatedAt } : user)))
    },
    [commit, resolve],
  )

  const reactivateUser = useCallback(
    async (userId: string) => {
      // The server first: the list changes only once the database has reactivated them.
      await reactivateStaff(userId)
      commit(latestRef.current.map((user) => (user.id === userId ? { ...user, deletedAt: undefined } : user)))
    },
    [commit],
  )

  const updateAdmin = useCallback(
    async (userId: string, details: AdminDetails) => {
      const target = latestRef.current.find((user) => user.id === userId && !user.deletedAt && isSystemAdmin(user))
      if (!target) throw new AdminActionError('not-found')
      const name = details.name.trim()
      const phone = normalizePhone(details.phone)
      const email = details.email.trim().toLowerCase()
      if (!name || !phone) throw new AdminActionError('invalid')
      // First, so that a failure leaves everything as it was.
      if (name !== target.name || phone !== target.phone) {
        const saved = await updateAdminDetails(userId, name, phone)
        commit(latestRef.current.map((user) => (user.id === userId ? { ...user, ...saved } : user)))
      }
      // Then the email, with the sign-in account (as Edit Staff does).
      if (email !== target.email.toLowerCase()) {
        const savedEmail = await changeUserEmail(userId, email)
        commit(latestRef.current.map((user) => (user.id === userId ? { ...user, email: savedEmail } : user)))
      }
    },
    [commit],
  )

  const deleteAdmin = useCallback(
    async (userId: string) => {
      await deleteAdminAccount(userId)
      const deletedAt = new Date().toISOString()
      commit(latestRef.current.map((user) => (user.id === userId ? { ...user, deletedAt } : user)))
    },
    [commit],
  )

  const store = useMemo<UsersStore>(
    () => ({ status, users, activeUsers, getUser, nameOf, addUser, updateUser, deleteUser, reactivateUser, updateAdmin, deleteAdmin }),
    [status, users, activeUsers, getUser, nameOf, addUser, updateUser, deleteUser, reactivateUser, updateAdmin, deleteAdmin],
  )

  return <UsersContext.Provider value={store}>{children}</UsersContext.Provider>
}
