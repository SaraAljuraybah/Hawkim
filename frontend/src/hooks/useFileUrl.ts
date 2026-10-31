import { useEffect, useState } from 'react'
import type { Sop, SopVersion } from '../data/mock/types'
import { localFileUrl } from '../lib/prototypeFiles'
import { signedFileUrl } from '../services/files'

/** The SOP's current version (the one its file comes from). */
export function currentVersionOf(sop: Sop): SopVersion | undefined {
  return sop.versions.find((version) => version.version === sop.version)
}

/**
 * A link to the SOP's current file for showing it: a signed link (10 minutes) for a
 * stored file, made when the file is shown, or the URL of a sample file (only object URLs and
 * same-origin paths, never a remote or protocol-relative link). Undefined
 * while it's being made, or when the person may not read the file (e.g. a reviewer,
 * until reviewers can read files) or there is no file (or no SOP).
 */
export function useFileUrl(sop: Sop | undefined): string | undefined {
  const storagePath = sop && currentVersionOf(sop)?.storagePath
  const [signed, setSigned] = useState<{ path: string; url?: string } | null>(null)

  useEffect(() => {
    if (!storagePath) return
    let active = true
    signedFileUrl(storagePath).then(
      (url) => active && setSigned({ path: storagePath, url }),
      () => active && setSigned({ path: storagePath }),
    )
    return () => {
      active = false
    }
  }, [storagePath])

  if (!storagePath) return localFileUrl(sop && (currentVersionOf(sop)?.fileUrl ?? sop.fileUrl))
  return signed?.path === storagePath ? signed.url : undefined
}
