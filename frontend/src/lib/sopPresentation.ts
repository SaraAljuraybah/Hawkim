import type { Sop } from '../data/mock/types'

/** Presentation only: internal SOP codes, file names and identifiers stay unchanged. */
export function sopDownloadName(title: string, version: string, fileType: string): string {
  // Remove file-system separators, control characters and trailing dots/spaces. Keep Unicode titles.
  const name = Array.from(title, (character) => character.charCodeAt(0) < 32 ? ' ' : character).join('')
    .replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  return `${name}_v${version}.${fileType}`
}

/** Retain the uploaded file label unless it exposes the SOP's generated serial number. */
export function sopFileLabel(sop: Pick<Sop, 'title' | 'version' | 'fileType' | 'fileName' | 'code'>): string {
  return sop.code && sop.fileName.toLowerCase().includes(sop.code.toLowerCase())
    ? sopDownloadName(sop.title, sop.version, sop.fileType)
    : sop.fileName
}
