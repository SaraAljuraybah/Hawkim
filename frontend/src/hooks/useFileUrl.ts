import type { Sop, SopVersion } from '../data/mock/types'
import { localFileUrl } from '../lib/prototypeFiles'

/** The SOP's current version (the one its file comes from). */
export function currentVersionOf(sop: Sop): SopVersion | undefined {
  return sop.versions.find((version) => version.version === sop.version)
}

/**
 * A local prototype link. Storage-backed files remain unavailable until the team
 * approves backend integration. No signed-link request or cached URL crosses users.
 */
export function useFileUrl(sop: Sop | undefined): string | undefined {
  const url = sop && (currentVersionOf(sop)?.fileUrl ?? sop.fileUrl)
  return localFileUrl(url)
}
