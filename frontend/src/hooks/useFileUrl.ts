import { useEffect, useState } from 'react'
import type { Sop, SopVersion } from '../data/mock/types'
import { localFileUrl } from '../lib/prototypeFiles'
import { signedFileUrl, SIGNED_URL_SECONDS } from '../services/files'
import { useSession } from '../state/sessionContext'

/** The SOP's current version (the one its file comes from). */
export function currentVersionOf(sop: Sop): SopVersion | undefined {
  return sop.versions.find((version) => version.version === sop.version)
}

/**
 * A signed link works for SIGNED_URL_SECONDS (10 minutes). A new one is made one minute before
 * that, while the page stays open, so the shown link is always valid.
 */
export const SIGNED_URL_REFRESH_MS = (SIGNED_URL_SECONDS - 60) * 1000

/** A signed link, for one signed-in user and one stored file. */
type Signed = { key: string; url?: string; signedAt: number }

/**
 * A link to the SOP's current file for showing it: a fresh signed link (10 minutes) for a stored
 * file, or the URL of a sample file (only object URLs and same-origin paths, never a remote or
 * protocol-relative link). Undefined while the link is being made, when Storage refuses it (e.g. the
 * person may not read the file), when nobody is signed in, or when there is no file (or no SOP).
 *
 * A signed link belongs to the signed-in user and the file it was made for: it is never shown to
 * another user (or after signing out) or for another SOP or version, and a reply that arrives after
 * any of these changed is ignored. It is renewed before it expires, and again when the tab comes
 * back after being away for longer than that.
 */
export function useFileUrl(sop: Sop | undefined): string | undefined {
  const userId = useSession().user?.id ?? ''
  const storagePath = sop && currentVersionOf(sop)?.storagePath
  const key = userId && storagePath ? `${userId}\n${storagePath}` : ''
  const [signed, setSigned] = useState<Signed | null>(null)
  // Bumped to ask for a new link (before expiry, or when the tab comes back with an old one).
  const [renewal, setRenewal] = useState(0)
  // Forget the link as soon as the user or the file changes, including signing out (and back in):
  // a link is never kept for later, even for the same person.
  const [linkedKey, setLinkedKey] = useState(key)
  if (linkedKey !== key) {
    setLinkedKey(key)
    setSigned(null)
  }

  useEffect(() => {
    if (!key || !storagePath) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    signedFileUrl(storagePath).then(
      (url) => {
        if (!active) return
        setSigned({ key, url, signedAt: Date.now() })
        timer = setTimeout(() => { if (active) setRenewal((count) => count + 1) }, SIGNED_URL_REFRESH_MS)
      },
      // Refused or failed (no access, network): show no link rather than an old one.
      () => { if (active) setSigned({ key, signedAt: Date.now() }) },
    )
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [key, storagePath, renewal])

  // Timers can be held back while a tab is hidden or the device sleeps: renew on return if needed.
  const signedAt = signed?.key === key ? signed.signedAt : undefined
  useEffect(() => {
    if (signedAt === undefined || typeof document === 'undefined') return
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - signedAt >= SIGNED_URL_REFRESH_MS) setRenewal((count) => count + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [signedAt])

  if (!storagePath) return localFileUrl(sop && (currentVersionOf(sop)?.fileUrl ?? sop.fileUrl))
  if (!key) return undefined
  // A link made for another user or file (or before signing out) is never returned.
  return linkedKey === key && signed?.key === key ? signed.url : undefined
}
