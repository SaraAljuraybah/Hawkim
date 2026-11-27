/**
 * The largest file each upload accepts, in bytes (1 MB = 1024 × 1024 bytes, as Supabase Storage counts). Checked in
 * the browser before uploading (FileDropzone, uploadSopFile, uploadGuidelineFile), then again by Storage and the
 * database. Each one equals its Storage bucket's file_size_limit, so a file the app accepts is never refused by Storage:
 *   SOP files        sop-files bucket, 10485760 (20261026120000_sops_and_versions.sql)
 *   GVP guidelines   guideline-files bucket, 20971520 (20261108120000_guideline_versions_admin.sql),
 *                    checked again by check_guideline_file (20261116230000_storage_organization_folders.sql)
 * A file exactly at the limit is accepted; one byte more is not.
 *
 * Why these sizes (measured 2026-11-26): the largest real SOP is 0.73 MB (20 PDFs, median 0.19 MB; 11 DOCX, largest
 * 0.04 MB), so 10 MB leaves a wide margin; the largest real GVP is 2.74 MB (GVP 4.0, 370 pages; 6 versions, median
 * 2.17 MB), so 20 MB leaves about 7 times that. Both stay well under the platform's per-file limit of 50 MB. Processing
 * time grows with a file's text, not its size (GVP 4.0 takes about 2 hours), so a much larger file is mostly images
 * or scans, which the compliance service can't read anyway.
 */
export const SOP_FILE_MAX_BYTES = 10 * 1024 * 1024
export const GUIDELINE_FILE_MAX_BYTES = 20 * 1024 * 1024

/** Whether a file is over the limit (checked before any upload starts). */
export function fileTooLarge(file: Pick<File, 'size'>, maxBytes: number): boolean {
  return file.size > maxBytes
}
