/*
 * People and departments from the database (tables profiles, user_roles and
 * departments; see supabase/migrations/). Rows are turned into the app's existing
 * User and Department types, so screens don't change. Row level security lets only
 * a signed-in person with an active profile read them; nobody can change them here.
 */

import type { Department, Permission, User } from '../data/mock/types'
import { PERMISSIONS } from '../lib/userAdmin'
import { supabase } from './supabase'

/** The columns read for a person, with their roles. */
const PROFILE_COLUMNS = 'id, full_name, email, initials, department_id, deleted_at, user_roles(role)'
const DEPARTMENT_COLUMNS = 'id, name, initials, description, removed_at'

export interface ProfileRow {
  id: string
  full_name: string
  email: string
  initials: string
  department_id: string
  deleted_at: string | null
  user_roles: { role: Permission }[]
}

export interface DepartmentRow {
  id: string
  name: string
  initials: string
  description: string
  removed_at: string | null
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

/** Everyone with a profile, ended ones included (their names stay on history), by name. */
export async function fetchPeople(): Promise<User[]> {
  const { data, error } = await supabase().from('profiles').select(PROFILE_COLUMNS).order('full_name')
  if (error) throw new Error(error.message)
  return (data as ProfileRow[]).map(toUser)
}

/** A department row as a Department. */
export function toDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    description: row.description,
    ...(row.removed_at ? { removedAt: row.removed_at } : {}),
  }
}

/** Every department, removed ones included (their names stay on old records), by name. */
export async function fetchDepartments(): Promise<Department[]> {
  const { data, error } = await supabase().from('departments').select(DEPARTMENT_COLUMNS).order('name')
  if (error) throw new Error(error.message)
  return (data as DepartmentRow[]).map(toDepartment)
}
