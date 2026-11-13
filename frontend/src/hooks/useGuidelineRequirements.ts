import { useEffect, useState } from 'react'
import type { GuidelineVersion, Requirement } from '../data/mock/types'
import { fetchGuidelineRequirements } from '../services/compliance'

/** A version's requirement passages for its page: shown, still being read, or they couldn't be read. */
export type GuidelineRequirementsState =
  | { state: 'ready'; requirements: Requirement[] }
  | { state: 'loading' | 'failed'; requirements: Requirement[] }

/** Passages read for one version. */
type Loaded = { id: string; requirements?: Requirement[] }

/**
 * A GVP version's requirement passages, read when its page opens. The versions list only knows how many
 * a published version has (`requirementCount`); versions that come with their passages (sample data)
 * or have none (an added version) aren't read.
 */
export function useGuidelineRequirements(version: GuidelineVersion): GuidelineRequirementsState & { retry: () => void } {
  const needsLoading = version.requirements.length === 0 && (version.requirementCount ?? 0) > 0
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!needsLoading) return
    let active = true
    fetchGuidelineRequirements(version.id).then(
      (requirements) => { if (active) setLoaded({ id: version.id, requirements }) },
      () => { if (active) setLoaded({ id: version.id }) },
    )
    return () => { active = false }
  }, [needsLoading, version.id, attempt])

  const retry = () => {
    setLoaded(null)
    setAttempt((count) => count + 1)
  }
  if (!needsLoading) return { state: 'ready', requirements: version.requirements, retry }
  if (loaded?.id !== version.id) return { state: 'loading', requirements: [], retry }
  return loaded.requirements ? { state: 'ready', requirements: loaded.requirements, retry } : { state: 'failed', requirements: [], retry }
}
