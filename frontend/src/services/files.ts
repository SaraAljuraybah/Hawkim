/*
 * SOP files in the private sop-files bucket (see supabase/migrations/). Each file is
 * stored as "<uploader id>/<random id>.pdf|docx"; its original name is kept in the
 * database and used for downloads. Files are opened through signed links that last
 * 10 minutes; a new link is made each time a file is shown.
 */

import type { SopFileType } from '../data/mock/types'
import type { StoredFile } from './sops'
import { supabase } from './supabase'

const BUCKET = 'sop-files'
/** How long a signed link works, in seconds. */
export const SIGNED_URL_SECONDS = 10 * 60

/** The type sent with each upload. Some systems report an empty type for .docx, which the bucket would refuse. */
const CONTENT_TYPES: Record<SopFileType, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

/** The file's type from its name, or undefined when it isn't a PDF or Word (.docx) file. */
export function fileTypeOf(fileName: string): SopFileType | undefined {
  const name = fileName.toLowerCase()
  return name.endsWith('.pdf') ? 'pdf' : name.endsWith('.docx') ? 'docx' : undefined
}

/** Where a new upload by this person goes: their own folder, a random name and the file's extension. */
export function storagePathFor(userId: string, fileType: SopFileType, id: string = crypto.randomUUID()): string {
  return `${userId}/${id}.${fileType}`
}

/** Uploads a file for a new SOP or version (never replacing one). */
export async function uploadSopFile(userId: string, file: File): Promise<StoredFile> {
  const fileType = fileTypeOf(file.name)
  if (!fileType) throw new Error('Only PDF and DOCX files can be uploaded')
  const storagePath = storagePathFor(userId, fileType)
  const { error } = await supabase().storage.from(BUCKET).upload(storagePath, file, { contentType: CONTENT_TYPES[fileType], upsert: false })
  if (error) throw new Error(error.message)
  return { storagePath, fileName: file.name }
}

/**
 * A link to the file that works for 10 minutes. With `downloadName` the browser saves
 * it under that name instead of showing it.
 */
export async function signedFileUrl(storagePath: string, downloadName?: string): Promise<string> {
  const { data, error } = await supabase()
    .storage.from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS, downloadName ? { download: downloadName } : undefined)
  if (error || !data) throw new Error(error?.message ?? 'No link was created')
  return data.signedUrl
}

/** The file of a version: a signed link for stored files, the existing URL for sample files, or undefined. */
export async function fileUrlOf(file: { storagePath?: string; fileUrl?: string }, downloadName?: string): Promise<string | undefined> {
  if (file.storagePath) return signedFileUrl(file.storagePath, downloadName)
  return file.fileUrl
}
