import { createContext, useContext } from 'react'
import type { Guideline, GuidelineVersion, Requirement } from '../data/mock/types'
import type { GuidelineEditInput } from '../lib/guidelines'
import type { GuidelineDetails } from '../services/guidelines'
import type { LoadStatus } from './useLoadAfterSignIn'

export interface GuidelinesStore {
  /** Whether the versions have been loaded from the database (after sign-in). */
  status: LoadStatus
  /** Every published version, oldest first (the last one is current). */
  versions: GuidelineVersion[]
  /** The current version: the published version added last. */
  current: GuidelineVersion
  /** The current version as recorded on a new compliance check. */
  currentGuideline: Guideline
  /**
   * Every version, the ones admins added (`neverCurrent`, loaded only for admins) included, oldest
   * first by the time they were added. Only the published ones while the added ones aren't loaded.
   */
  allVersions: GuidelineVersion[]
  /**
   * Whether the versions admins added have loaded ('ready' for everyone else). Loaded apart from the
   * published versions: if this fails, only the SFDA Regulatory Requirements tab shows it.
   */
  addedStatus: LoadStatus
  /** Loads the versions admins added again (after they couldn't be loaded). */
  retryAdded: () => void
  /** A version by id, added ones included. */
  getVersion: (id: string | undefined) => GuidelineVersion | undefined
  /** A requirement of a given guideline version (as a report was checked against it). */
  getRequirement: (guidelineVersion: string, requirementId: string) => Requirement | undefined
  /**
   * Uploads the PDF and adds the version (PBI 20). It is never current. Throws a GuidelineError
   * (services/guidelines.ts) when it can't be saved; the uploaded file is then removed.
   */
  addVersion: (details: GuidelineDetails, file: File) => Promise<void>
  /**
   * Saves a version's title, SFDA issue date and source, and its version number if it was never
   * current; with `file`, then adds that PDF to a published version that has none. Throws a GuidelineError.
   */
  updateVersion: (id: string, input: GuidelineEditInput, file?: File) => Promise<void>
  /**
   * Deletes a version that was never current, and its file: 'deleted', or 'cancelled' when it was
   * being processed (the compliance service stops and deletes it). Throws a GuidelineError.
   */
  deleteVersion: (id: string) => Promise<'deleted' | 'cancelled'>
  /** Processes an added version again after processing failed. Throws a GuidelineError. */
  retryProcessing: (id: string) => Promise<void>
  /** Makes a processed added version current; returns its new id. Throws a GuidelineError. */
  makeCurrent: (id: string) => Promise<string>
}

export const GuidelinesContext = createContext<GuidelinesStore | null>(null)

/** Access the shared guidelines store. Must be used inside <GuidelinesProvider>. */
export function useGuidelines(): GuidelinesStore {
  const store = useContext(GuidelinesContext)
  if (!store) throw new Error('useGuidelines must be used inside <GuidelinesProvider>')
  return store
}
