import type { SopFileType, SopVersion } from '../data/mock/types'

/** Restrict previews to object URLs and same-origin paths; reject URL normalization escapes. */
export function localFileUrl(url: string | undefined): string | undefined {
  if (!url || [...url].some((character) => character === '\\' || character.charCodeAt(0) <= 32)) return undefined
  return url.startsWith('blob:') || /^\/(?!\/)/.test(url) ? url : undefined
}

/** Sample (in-memory) SOP files only: object URLs and same-origin paths. Stored files use services/files.ts. */
export function fileUrlOf(version: Pick<SopVersion, 'fileUrl' | 'storagePath'>, _downloadName?: string): Promise<string | undefined> {
  return Promise.resolve(localFileUrl(version.fileUrl))
}

export function fileTypeOf(file: Pick<File, 'name'>): SopFileType {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.docx')) return 'docx'
  throw new Error('Only PDF and DOCX files are supported')
}
