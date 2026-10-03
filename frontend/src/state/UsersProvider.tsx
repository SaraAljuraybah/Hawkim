import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { usersEn } from '../content/users.en'
import { sampleUsers } from '../data/mock/users'
import type { User } from '../data/mock/types'
import { UsersContext, type UsersStore } from './usersContext'

/**
 * In-memory users store shared by the employee screens (names, people pickers),
 * sign-in and the admin portal. Starts with the sample users; changes are lost on reload.
 * TODO: Replace with API calls once the backend exists.
 */
export function UsersProvider({ children }: { children: ReactNode }) {
  const [users] = useState<User[]>(sampleUsers)

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

  const store = useMemo<UsersStore>(
    () => ({ users, activeUsers, getUser, nameOf }),
    [users, activeUsers, getUser, nameOf],
  )

  return <UsersContext.Provider value={store}>{children}</UsersContext.Provider>
}
