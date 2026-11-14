/*
 * The caller's organization's folder: the first part of every file they upload, in sop-files and
 * guideline-files (supabase/migrations/20261116230000_storage_organization_folders.sql). The database
 * refuses an upload anywhere else.
 */

import { supabase } from './supabase'

/** The caller's organization's id (current_organization_id), the folder their uploads go in. */
export async function organizationFolder(): Promise<string> {
  const { data, error } = await supabase().rpc('current_organization_id')
  if (error) throw new Error(error.message)
  if (typeof data !== 'string' || !data) throw new Error('No organization for this account')
  return data
}
