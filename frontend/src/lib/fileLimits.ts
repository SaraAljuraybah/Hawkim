/**
 * The largest file each upload accepts, in bytes (1 MB = 1024 × 1024 bytes, as Supabase Storage counts).
 * Each one equals its Storage bucket's file_size_limit, so a file the app accepts is never refused by Storage:
 *   SOP files        sop-files bucket, 10485760 (20261026120000_sops_and_versions.sql)
 *   GVP guidelines   guideline-files bucket, 20971520 (20261108120000_guideline_versions_admin.sql),
 *                    checked again by check_guideline_file (20261116230000_storage_organization_folders.sql)
 * A file exactly at the limit is accepted; one byte more is not.
 */
export const SOP_FILE_MAX_BYTES = 10 * 1024 * 1024
export const GUIDELINE_FILE_MAX_BYTES = 20 * 1024 * 1024

/** Whether a file is over the limit (checked before any upload starts). */
export function fileTooLarge(file: Pick<File, 'size'>, maxBytes: number): boolean {
  return file.size > maxBytes
}
