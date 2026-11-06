import type { GuidelineVersion, Sop } from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { riyadhDate } from './riyadhWorkingDays'

/*
 * Rules for the regulation SOPs are checked against (PBI 20, 29). Hawkim manages one
 * regulation, the SFDA GVP; the admin adds new versions, and the latest one added is
 * current at once. Old versions stay as read-only history. Pure functions: the
 * guidelines store refuses what they don't allow, and the pages use them to explain why.
 * TODO: The backend must enforce these same rules.
 */

/** A version number: digits, a dot, digits (4.1, 5.0, 4.10). */
const VERSION_PATTERN = /^\d+\.\d+$/
export const TITLE_MAX = 100
export const SOURCE_MAX = 300

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

/** A web link starting with https://, with a host (e.g. https://www.sfda.gov.sa/...). */
export function isHttpsLink(value: string): boolean {
  if (!value.startsWith('https://')) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.includes('.') && !/\s/.test(value)
  } catch {
    return false
  }
}

/**
 * An official SFDA link: an https:// link whose host is sfda.gov.sa or one of its subdomains
 * (www.sfda.gov.sa). The host is compared exactly, never with "contains", so look-alikes such as
 * https://sfda.gov.sa.example.com or https://notsfda.gov.sa are refused.
 */
export function isSfdaLink(value: string): boolean {
  if (!isHttpsLink(value)) return false
  // URL gives the host in lower case, without any user name or port.
  const { hostname } = new URL(value)
  return hostname === 'sfda.gov.sa' || hostname.endsWith('.sfda.gov.sa')
}

/* ---------- Adding a version ---------- */

/** What the admin enters (the file is only its name for now). */
export interface GuidelineVersionInput {
  title: string
  /** Entered by the admin, e.g. "4.1". */
  version: string
  /** ISO date, or '' when not given. */
  issuedDate: string
  /** Today in Asia/Riyadh when the form opened (ISO date); it can't be changed. */
  addedDate: string
  /** '' when no file was chosen. */
  fileName: string
  /** A temporary link to the chosen PDF in this browser, to open it later in this tab. */
  fileUrl?: string
  /** A link to the guideline on the SFDA website. */
  source: string
}

export type GuidelineField = 'title' | 'version' | 'issuedDate' | 'addedDate' | 'fileName' | 'source'
export type GuidelineProblem =
  | 'title-required'
  | 'title-too-long'
  | 'version-invalid'
  | 'version-exists'
  | 'version-not-higher'
  | 'issued-after-added'
  | 'added-required'
  | 'file-required'
  | 'file-not-pdf'
  | 'source-required'
  | 'source-invalid'
  | 'source-not-sfda'
  | 'source-too-long'

/**
 * What is wrong with each field (nothing for a valid version). The version must be new and
 * higher than the current one (the latest added).
 */
export function validateGuidelineVersion(
  input: GuidelineVersionInput,
  versions: GuidelineVersion[],
): Partial<Record<GuidelineField, GuidelineProblem>> {
  const title = input.title.trim()
  const version = input.version.trim()
  const fileName = input.fileName.trim()
  const source = input.source.trim()
  const current = currentVersion(versions)
  return {
    title: !title ? 'title-required' : title.length > TITLE_MAX ? 'title-too-long' : undefined,
    version: !VERSION_PATTERN.test(version)
      ? 'version-invalid'
      : versions.some((item) => compareVersions(item.version, version) === 0)
        ? 'version-exists'
        : current && compareVersions(version, current.version) <= 0
          ? 'version-not-higher'
          : undefined,
    addedDate: input.addedDate ? undefined : 'added-required',
    // ISO dates compare correctly as strings.
    issuedDate: input.issuedDate && input.addedDate && input.issuedDate > input.addedDate ? 'issued-after-added' : undefined,
    fileName: !fileName ? 'file-required' : !fileName.toLowerCase().endsWith('.pdf') ? 'file-not-pdf' : undefined,
    source: !source
      ? 'source-required'
      : source.length > SOURCE_MAX
        ? 'source-too-long'
        : !isHttpsLink(source)
          ? 'source-invalid'
          : !isSfdaLink(source)
            ? 'source-not-sfda'
            : undefined,
  }
}

/**
 * The new version, which becomes current. Its requirements are copied from the
 * previous version for now. The database also needs an effective date: it is the added date.
 * TODO: The compliance service extracts the requirements from the uploaded PDF.
 */
export function newGuidelineVersion(
  input: GuidelineVersionInput,
  previous: GuidelineVersion,
  addedById: string,
  addedAt = new Date().toISOString(),
): GuidelineVersion {
  const version = input.version.trim()
  return {
    id: `gvp-${version.replace('.', '-')}`,
    title: input.title.trim(),
    version,
    ...(input.issuedDate ? { issuedDate: input.issuedDate } : {}),
    effectiveDate: input.addedDate,
    fileName: input.fileName.trim(),
    ...(input.fileUrl ? { fileUrl: input.fileUrl } : {}),
    source: input.source.trim(),
    addedById,
    addedAt,
    requirements: previous.requirements.map((requirement) => ({ ...requirement })),
  }
}

/* ---------- Editing and deleting a version ---------- */

/** What can be edited: the version number, the added date and the file stay. */
export type GuidelineEditInput = Pick<GuidelineVersionInput, 'title' | 'issuedDate' | 'source'>

/** The Riyadh date a version was added to Hawkim (ISO date), if known. */
export function addedDateOf(version: GuidelineVersion): string {
  return version.addedAt ? riyadhDate(new Date(version.addedAt)) : version.effectiveDate
}

/** What is wrong with an edit: the same rules as adding, for the fields that can change. */
export function validateGuidelineEdit(input: GuidelineEditInput, version: GuidelineVersion): Partial<Record<GuidelineField, GuidelineProblem>> {
  const problems = validateGuidelineVersion(
    { ...input, version: version.version, addedDate: addedDateOf(version), fileName: version.fileName },
    [],
  )
  return { title: problems.title, issuedDate: problems.issuedDate, source: problems.source }
}

/** The version with its new title, SFDA issue date and source. */
export function editedGuidelineVersion(version: GuidelineVersion, input: GuidelineEditInput): GuidelineVersion {
  const { issuedDate: _previous, ...rest } = version
  return { ...rest, title: input.title.trim(), ...(input.issuedDate ? { issuedDate: input.issuedDate } : {}), source: input.source.trim() }
}

/**
 * Whether any SOP's running or completed compliance check used this guideline version. Failed
 * checks produced no results, so they don't count.
 */
export function checkedAgainst(version: GuidelineVersion, sops: Pick<Sop, 'complianceChecks'>[]): boolean {
  return sops.some((sop) => sop.complianceChecks.some((check) =>
    check.status !== 'failed' && compareVersions(check.guideline.version, version.version) === 0))
}

/**
 * Why a version can't be deleted: it is the current one, or SOPs were checked against it
 * (their reports look up its requirements). Only the SOPs this browser has are known.
 */
export function deleteVersionBlocker(
  version: GuidelineVersion,
  versions: GuidelineVersion[],
  sops: Pick<Sop, 'complianceChecks'>[],
): 'current' | 'checked' | undefined {
  if (currentVersion(versions)?.id === version.id) return 'current'
  return checkedAgainst(version, sops) ? 'checked' : undefined
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
