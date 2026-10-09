import { createContext, useContext } from 'react'
import type { Guideline, GuidelineVersion, Requirement, User } from '../data/mock/types'
import type { GuidelineVersionInput } from '../lib/guidelines'

export interface GuidelinesStore {
  /** Every version, oldest first (the last one is current). */
  versions: GuidelineVersion[]
  /** The current version: the latest added. */
  current: GuidelineVersion
  /** The current version as recorded on a new compliance check. */
  currentGuideline: Guideline
  /** A version by id. */
  getVersion: (id: string | undefined) => GuidelineVersion | undefined
  /** A requirement of a given guideline version (as a report was checked against it). */
  getRequirement: (guidelineVersion: string, requirementId: string) => Requirement | undefined
  /**
   * Adds a version (PBI 20), which becomes current at once. Checks lib/guidelines.ts
   * and that `actorId` is an active admin; throws if not allowed.
   */
  addVersion: (input: GuidelineVersionInput, actor: { actorId: string; users: User[] }) => GuidelineVersion
}

export const GuidelinesContext = createContext<GuidelinesStore | null>(null)

/** Access the shared guidelines store. Must be used inside <GuidelinesProvider>. */
export function useGuidelines(): GuidelinesStore {
  const store = useContext(GuidelinesContext)
  if (!store) throw new Error('useGuidelines must be used inside <GuidelinesProvider>')
  return store
}
