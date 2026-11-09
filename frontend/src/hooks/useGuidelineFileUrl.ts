import { useEffect, useState } from 'react'
import type { GuidelineVersion } from '../data/mock/types'
import { localFileUrl } from '../lib/prototypeFiles'
import { signedGuidelineFileUrl } from '../services/guidelines'
import { useSession } from '../state/sessionContext'
import { SIGNED_URL_REFRESH_MS } from './useFileUrl'

/** A version's PDF for showing it: a link, still being made, none (no PDF), or the link couldn't be made. */
export type GuidelineFile = { state: 'ready'; url: string } | { state: 'loading' | 'none' | 'failed'; url?: undefined }

/** A signed link, for one signed-in user and one stored file. */
type Signed = { key: string; url?: string }

/**
 * A link to a GVP version's PDF: a fresh signed link (10 minutes) for a stored PDF, renewed a minute
 * before it expires while the page stays open, or the URL of a sample PDF. Like useFileUrl, a link is
 * only ever shown to the user it was made for and for the file it was made for.
 */
export function useGuidelineFileUrl(version: GuidelineVersion | undefined): GuidelineFile {
  const userId = useSession().user?.id ?? ''
  const storagePath = version?.storagePath
  const key = userId && storagePath ? `${userId}\n${storagePath}` : ''
  const [signed, setSigned] = useState<Signed | null>(null)
  const [renewal, setRenewal] = useState(0)

  useEffect(() => {
    if (!key || !storagePath) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    signedGuidelineFileUrl(storagePath).then(
      (url) => {
        if (!active) return
        setSigned({ key, url })
        timer = setTimeout(() => { if (active) setRenewal((count) => count + 1) }, SIGNED_URL_REFRESH_MS)
      },
      // Refused or failed (no access, network): say so rather than show an old link.
      () => { if (active) setSigned({ key }) },
    )
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [key, storagePath, renewal])

  if (!storagePath) {
    const sample = localFileUrl(version?.fileUrl)
    return sample ? { state: 'ready', url: sample } : { state: 'none' }
  }
  if (!key || signed?.key !== key) return { state: 'loading' }
  return signed.url ? { state: 'ready', url: signed.url } : { state: 'failed' }
}
