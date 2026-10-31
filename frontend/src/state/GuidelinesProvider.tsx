import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { GVP_NAME, sampleGuidelineVersions } from '../data/mock/compliance'
import type { GuidelineVersion } from '../data/mock/types'
import { currentVersion, newGuidelineVersion, validateGuidelineVersion } from '../lib/guidelines'
import { GuidelinesContext, type GuidelinesStore } from './guidelinesContext'
import { useLoadAfterSignIn } from './useLoadAfterSignIn'
import { fetchGuidelineVersions } from '../services/compliance'

/**
 * Store of the GVP versions (shared, like departments): compliance checks use the
 * current one, and reports look up requirements in the version they were checked
 * against. The versions and their requirements are loaded from the database after
 * sign-in (until then the sample v4.0 stands in, but no page shows before they load).
 * Adding a version (admin portal) only changes this tab's copy, and checks in the
 * database always use the database's current version.
 * TODO: Save new versions once guideline upload is connected.
 * Must be inside <SessionProvider>.
 */
export function GuidelinesProvider({ children }: { children: ReactNode }) {
  const [versions, setVersions] = useState<GuidelineVersion[]>(sampleGuidelineVersions)
  // The latest list (as in the other stores): actions check against it, not the last render.
  const latestRef = useRef<GuidelineVersion[]>(sampleGuidelineVersions)
  const commit = useCallback((next: GuidelineVersion[]) => {
    latestRef.current = next
    setVersions(next)
  }, [])
  const status = useLoadAfterSignIn(fetchGuidelineVersions, commit)

  const current = currentVersion(versions)
  const currentGuideline = useMemo(() => ({ name: GVP_NAME, version: current.version }), [current.version])
  const getVersion = useCallback((id: string | undefined) => versions.find((item) => item.id === id), [versions])
  const getRequirement = useCallback(
    (guidelineVersion: string, requirementId: string) =>
      versions
        .find((item) => item.version === guidelineVersion)
        ?.requirements.find((requirement) => requirement.id === requirementId),
    [versions],
  )

  const addVersion = useCallback<GuidelinesStore['addVersion']>((input, { actorId, users }) => {
    const actor = users.find((user) => user.id === actorId && !user.deletedAt)
    if (!actor?.permissions.includes('admin')) throw new Error('Only an admin can add guideline versions')
    const previous = currentVersion(latestRef.current)
    if (Object.values(validateGuidelineVersion(input, previous)).some(Boolean)) {
      throw new Error('The guideline version is not valid')
    }
    const added = newGuidelineVersion(input, previous, actorId)
    commit([...latestRef.current, added])
    return added
  }, [commit])

  const store = useMemo<GuidelinesStore>(
    () => ({ status, versions, current, currentGuideline, getVersion, getRequirement, addVersion }),
    [status, versions, current, currentGuideline, getVersion, getRequirement, addVersion],
  )

  return <GuidelinesContext.Provider value={store}>{children}</GuidelinesContext.Provider>
}
