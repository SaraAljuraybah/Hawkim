import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { GVP_NAME, sampleGuidelineVersions } from '../data/mock/compliance'
import type { GuidelineVersion } from '../data/mock/types'
import { currentVersion, newGuidelineVersion, validateGuidelineVersion } from '../lib/guidelines'
import { GuidelinesContext, type GuidelinesStore } from './guidelinesContext'

/**
 * In-memory store of the GVP versions (shared, like departments): the admin adds
 * versions, compliance checks use the current one, and reports look up requirements
 * in the version they were checked against. Starts with v4.0; changes are lost on reload.
 * TODO: Replace with API calls once the backend exists.
 */
export function GuidelinesProvider({ children }: { children: ReactNode }) {
  const [versions, setVersions] = useState<GuidelineVersion[]>(sampleGuidelineVersions)
  // The latest list (as in the other stores): actions check against it, not the last render.
  const latestRef = useRef<GuidelineVersion[]>(sampleGuidelineVersions)

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
    latestRef.current = [...latestRef.current, added]
    setVersions(latestRef.current)
    return added
  }, [])

  const store = useMemo<GuidelinesStore>(
    () => ({ versions, current, currentGuideline, getVersion, getRequirement, addVersion }),
    [versions, current, currentGuideline, getVersion, getRequirement, addVersion],
  )

  return <GuidelinesContext.Provider value={store}>{children}</GuidelinesContext.Provider>
}
