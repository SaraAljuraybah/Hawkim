import type { GuidelineVersion, Sop } from '../data/mock/types'
import type { SopStatus } from '../types/status'

/*
 * Rules for the regulation SOPs are checked against (PBI 20, 29). Hawkim manages one
 * regulation, the SFDA GVP; the admin adds new versions, and the latest one added is
 * current at once. Old versions stay as read-only history. Pure functions: the
 * guidelines store refuses what they don't allow, and the pages use them to explain why.
 * TODO: The backend must enforce these same rules.
 */

/** A version number: digits, a dot, digits (4.1, 5.0, 4.10). */
const VERSION_PATTERN = /^\d+\.\d+$/
export const SUMMARY_MAX = 500

/** Orders version numbers part by part, as numbers: 4.10 > 4.9 > 4.0. Negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor] = a.split('.').map(Number)
  const [bMajor, bMinor] = b.split('.').map(Number)
  return aMajor !== bMajor ? aMajor - bMajor : aMinor - bMinor
}

/** The current version: the latest one added (versions are kept in the order they were added). */
export function currentVersion(versions: GuidelineVersion[]): GuidelineVersion {
  return versions[versions.length - 1]
}

/* ---------- Adding a version ---------- */

/** What the admin enters (the file is only its name for now). */
export interface GuidelineVersionInput {
  version: string
  /** ISO date, or '' when not given. */
  issuedDate: string
  /** ISO date. */
  effectiveDate: string
  /** '' when no file was chosen. */
  fileName: string
  summary: string
}

export type GuidelineField = 'version' | 'issuedDate' | 'effectiveDate' | 'fileName' | 'summary'
export type GuidelineProblem =
  | 'version-invalid'
  | 'version-not-higher'
  | 'issued-after-effective'
  | 'effective-required'
  | 'file-required'
  | 'file-not-pdf'
  | 'summary-too-long'

/** What is wrong with each field (nothing for a valid version). It must be higher than the current version. */
export function validateGuidelineVersion(
  input: GuidelineVersionInput,
  current: GuidelineVersion,
): Partial<Record<GuidelineField, GuidelineProblem>> {
  const version = input.version.trim()
  const fileName = input.fileName.trim()
  return {
    version: !VERSION_PATTERN.test(version)
      ? 'version-invalid'
      : compareVersions(version, current.version) <= 0
        ? 'version-not-higher'
        : undefined,
    effectiveDate: input.effectiveDate ? undefined : 'effective-required',
    // ISO dates compare correctly as strings.
    issuedDate:
      input.issuedDate && input.effectiveDate && input.issuedDate > input.effectiveDate ? 'issued-after-effective' : undefined,
    fileName: !fileName ? 'file-required' : !fileName.toLowerCase().endsWith('.pdf') ? 'file-not-pdf' : undefined,
    summary: input.summary.trim().length > SUMMARY_MAX ? 'summary-too-long' : undefined,
  }
}

/**
 * The new version, which becomes current. Its requirements are copied from the
 * previous version for now.
 * TODO: The compliance service extracts the requirements from the uploaded PDF.
 */
export function newGuidelineVersion(
  input: GuidelineVersionInput,
  previous: GuidelineVersion,
  addedById: string,
  addedAt = new Date().toISOString(),
): GuidelineVersion {
  const version = input.version.trim()
  const summary = input.summary.trim()
  return {
    id: `gvp-${version.replace('.', '-')}`,
    version,
    ...(input.issuedDate ? { issuedDate: input.issuedDate } : {}),
    effectiveDate: input.effectiveDate,
    fileName: input.fileName.trim(),
    ...(summary ? { summary } : {}),
    addedById,
    addedAt,
    requirements: previous.requirements.map((requirement) => ({ ...requirement })),
  }
}

/* ---------- SOPs checked against an older version ---------- */

/** Only where the author can act on it: drafts, returned and published SOPs. */
const FLAGGED_STATUSES: SopStatus[] = ['draft', 'returned', 'published']

/** The guideline version of the SOP's newest completed check, if any. */
export function lastCheckedVersion(sop: Sop): string | undefined {
  return [...sop.complianceChecks].reverse().find((check) => check.status === 'completed')?.guideline.version
}

/**
 * "Recheck recommended": the SOP's newest completed check used an older guideline
 * version than the current one. The author rechecks; nothing is rechecked automatically.
 */
export function recheckRecommended(sop: Sop, currentGuidelineVersion: string): boolean {
  const checked = lastCheckedVersion(sop)
  return FLAGGED_STATUSES.includes(sop.status) && checked !== undefined && checked !== currentGuidelineVersion
}
