/*
 * People and departments from the database (tables profiles, user_roles and
 * departments; see supabase/migrations/). Rows are turned into the app's existing
 * User and Department types, so screens don't change. Row level security lets only
 * a signed-in person with an active profile read them; nobody can change them here.
 */

import type { Permission, User } from '../data/mock/types'
import { PERMISSIONS } from '../lib/userAdmin'
import { supabase } from './supabase'

/** The columns read for a person, with their roles. */
const PROFILE_COLUMNS = 'id, full_name, email, initials, department_id, deleted_at, user_roles(role)'

export interface ProfileRow {
  id: string
  full_name: string
  email: string
  initials: string
  department_id: string
  deleted_at: string | null
  user_roles: { role: Permission }[]
}

/** A profile row as a User: roles become permissions, in the usual display order. */
export function toUser(row: ProfileRow): User {
  const roles = row.user_roles.map((item) => item.role)
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    initials: row.initials,
    departmentId: row.department_id,
    permissions: PERMISSIONS.filter((permission) => roles.includes(permission)),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  }
}

/**
 * The signed-in person's profile, or null when they have none or it was ended
 * (row level security then shows them nothing). Throws if the database can't be reached.
 */
export async function fetchProfile(userId: string): Promise<User | null> {
  const { data, error } = await supabase().from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as ProfileRow | null
  return row && !row.deleted_at ? toUser(row) : null
}
