import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { GVP_NAME, sampleGuidelineVersions } from '../data/mock/compliance'
import type { GuidelineVersion } from '../data/mock/types'
import { currentVersion } from '../lib/guidelines'
import { hasPermission } from '../lib/permissions'
import { fetchGuidelineVersions } from '../services/compliance'
import {
  attachGuidelineFile,
  createGuidelineVersion,
  deleteAddedGuidelineVersion,
  fetchAddedGuidelineVersions,
  makeGuidelineCurrent,
  retryGuidelineProcessing,
  removeGuidelineFile,
  updateAddedGuidelineVersion,
  updatePublishedGuidelineVersion,
  uploadGuidelineFile,
} from '../services/guidelines'
import { GuidelinesContext, type GuidelinesStore } from './guidelinesContext'
import { useSession } from './sessionContext'
import { useLoadAfterSignIn, type LoadStatus } from './useLoadAfterSignIn'

/** The versions admins added, for one signed-in admin (`key`), and whether they loaded. */
interface Added {
  key: string
  status: LoadStatus
  versions: GuidelineVersion[]
}

/** Oldest first by the time each was added. */
function byAddedTime(versions: GuidelineVersion[]): GuidelineVersion[] {
  return [...versions].sort((a, b) => (a.addedAt ?? '').localeCompare(b.addedAt ?? ''))
}

/** Uploads the file, then saves with it; removes the file again if saving fails. */
async function withUploadedFile(file: File, save: (storagePath: string) => Promise<unknown>): Promise<void> {
  const storagePath = await uploadGuidelineFile(file)
  try {
    await save(storagePath)
  } catch (error) {
    await removeGuidelineFile(storagePath)
    throw error
  }
}

/**
 * Store of the GVP versions (shared, like departments): compliance checks use the
 * current one, and reports look up requirements in the version they were checked
 * against. The published versions and their requirements are loaded from the database after
 * sign-in (until then the sample v4.0 stands in, but no page shows before they load).
 * For admins, the versions admins added (never current) are loaded separately: if that fails,
 * only the SFDA Regulatory Requirements tab says so (`addedStatus`, `retryAdded`), and the rest
 * of the portal keeps working. Each change is saved in the database (which checks the rules and
 * that the caller is an admin), then everything is loaded again.
 * Must be inside <SessionProvider>.
 */
/** How often added versions are read again while one is being processed. */
const PROCESSING_REFRESH_MS = 10_000

export function GuidelinesProvider({ children }: { children: ReactNode }) {
  const user = useSession().user
  // Only admins read the added versions.
  const addedKey = user && hasPermission(user, 'admin') ? user.id : ''

  const [published, setPublished] = useState<GuidelineVersion[]>(sampleGuidelineVersions)
  const publishedRef = useRef(published)
  const commitPublished = useCallback((next: GuidelineVersion[]) => {
    publishedRef.current = next
    setPublished(next)
  }, [])
  // What every page waits for: the published versions only, as before.
  const status = useLoadAfterSignIn(fetchGuidelineVersions, commitPublished)

  const [added, setAdded] = useState<Added>({ key: '', status: 'loading', versions: [] })
  const addedRef = useRef(added)
  // The admin whose added versions are wanted now: a reply for anyone else is ignored.
  const addedKeyRef = useRef(addedKey)
  const readAdded = useCallback(async (key: string): Promise<Added> => {
    try {
      return { key, status: 'ready', versions: await fetchAddedGuidelineVersions() }
    } catch {
      // Keep any versions already shown for this admin, and say they couldn't be refreshed.
      return { key, status: 'error', versions: addedRef.current.key === key ? addedRef.current.versions : [] }
    }
  }, [])
  const commitAdded = useCallback((next: Added) => {
    if (addedKeyRef.current !== next.key) return
    addedRef.current = next
    setAdded(next)
  }, [])
  const loadAdded = useCallback(async (key: string) => commitAdded(await readAdded(key)), [commitAdded, readAdded])
  useEffect(() => {
    addedKeyRef.current = addedKey
    if (addedKey) void loadAdded(addedKey)
  }, [addedKey, loadAdded])
  const retryAdded = useCallback(() => {
    const key = addedKeyRef.current
    if (!key) return
    setAdded((prev) => (prev.key === key ? { ...prev, status: 'loading' } : prev))
    void loadAdded(key)
  }, [loadAdded])

  const addedVersions = useMemo(() => (added.key === addedKey ? added.versions : []), [added, addedKey])
  const addedStatus: LoadStatus = !addedKey ? 'ready' : added.key === addedKey ? added.status : 'loading'

  // The added versions are read before the published ones, and both are shown together: a version that
  // left the added ones was published before the published ones were read, so a page never finds it in
  // neither list (the version's page takes that as deleted).
  const reload = useCallback(async () => {
    const key = addedKeyRef.current
    const nextAdded = key ? await readAdded(key) : undefined
    let nextPublished: GuidelineVersion[] | undefined
    try {
      nextPublished = await fetchGuidelineVersions()
    } catch {
      // Keep the published versions shown; the added ones wait for the next read, unless they failed too.
    }
    if (nextPublished) commitPublished(nextPublished)
    if (nextAdded && (nextPublished || nextAdded.status === 'error')) commitAdded(nextAdded)
  }, [commitAdded, commitPublished, readAdded])

  const versions = published
  const current = currentVersion(versions)
  const allVersions = useMemo(() => byAddedTime([...published, ...addedVersions]), [published, addedVersions])
  const currentGuideline = useMemo(() => ({ name: GVP_NAME, version: current.version }), [current.version])
  const getVersion = useCallback((id: string | undefined) => allVersions.find((item) => item.id === id), [allVersions])
  const getRequirement = useCallback(
    (guidelineVersion: string, requirementId: string) =>
      versions
        .find((item) => item.version === guidelineVersion)
        ?.requirements.find((requirement) => requirement.id === requirementId),
    [versions],
  )

  /** Saves, then loads the versions again, whether or not saving worked (another admin may have changed them). */
  const thenReload = useCallback(async (save: () => Promise<void>) => {
    try {
      await save()
    } finally {
      await reload()
    }
  }, [reload])

  const addVersion = useCallback<GuidelinesStore['addVersion']>((details, file) => thenReload(() =>
    withUploadedFile(file, (storagePath) => createGuidelineVersion(details, storagePath, file.name)),
  ), [thenReload])

  const updateVersion = useCallback<GuidelinesStore['updateVersion']>((id, input, file) => thenReload(async () => {
    const version = [...publishedRef.current, ...addedRef.current.versions].find((item) => item.id === id)
    if (!version) throw new Error('Unknown guideline version')
    if (version.neverCurrent) {
      await updateAddedGuidelineVersion(id, input)
      return
    }
    await updatePublishedGuidelineVersion(id, input)
    if (file && !version.storagePath) await withUploadedFile(file, (storagePath) => attachGuidelineFile(id, storagePath))
  }), [thenReload])

  const deleteVersion = useCallback<GuidelinesStore['deleteVersion']>(async (id) => {
    let outcome: 'deleted' | 'cancelled' = 'deleted'
    await thenReload(async () => {
      const result = await deleteAddedGuidelineVersion(id)
      outcome = result.outcome
      // A cancelled version's file is deleted by the compliance service, after it stops.
      if (result.outcome === 'deleted' && result.storagePath) await removeGuidelineFile(result.storagePath)
    })
    return outcome
  }, [thenReload])

  const retryProcessing = useCallback<GuidelinesStore['retryProcessing']>((id) => thenReload(() => retryGuidelineProcessing(id)), [thenReload])

  const makeCurrent = useCallback<GuidelinesStore['makeCurrent']>(async (id) => {
    let newId = ''
    await thenReload(async () => { newId = await makeGuidelineCurrent(id) })
    return newId
  }, [thenReload])

  // While the compliance service processes an added version, read the added versions again now and then.
  const processing = addedVersions.some((version) => version.processing?.status === 'waiting' || version.processing?.status === 'processing')
  useEffect(() => {
    if (!processing) return
    // Both lists: a version that finishes processing leaves the added ones and becomes the current published one.
    const timer = window.setInterval(() => void reload(), PROCESSING_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [processing, reload])

  const store = useMemo<GuidelinesStore>(
    () => ({ status, versions, current, currentGuideline, allVersions, addedStatus, retryAdded, getVersion, getRequirement, addVersion, updateVersion, deleteVersion, retryProcessing, makeCurrent }),
    [status, versions, current, currentGuideline, allVersions, addedStatus, retryAdded, getVersion, getRequirement, addVersion, updateVersion, deleteVersion, retryProcessing, makeCurrent],
  )

  return <GuidelinesContext.Provider value={store}>{children}</GuidelinesContext.Provider>
}
