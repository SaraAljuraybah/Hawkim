import type { GuidelineVersion, Sop } from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { riyadhDate } from './riyadhWorkingDays'

/*
 * Rules for the regulation SOPs are checked against (PBI 20, 29). Hawkim manages one
 * regulation, the SFDA GVP. The current version is the database's (the published version added
 * last); a version an admin adds is never current (`neverCurrent`): making one current comes
 * later. Pure functions: the forms use them to explain what's wrong before saving, and the
 * database (supabase/migrations/20261108120000_guideline_versions_admin.sql) enforces the same rules.
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

/**
 * The version the SFDA Regulatory Requirements tab shows as current: the newest published one by when
 * it was added (`allVersions` is oldest first). A version an admin added isn't current until an admin
 * makes it current (GVP phase 2: processing, then Make Current), so it never gets the Current badge.
 * Compliance checks, reports and every other page use the database's current version (`currentVersion`).
 */
export function newestVersion(allVersions: GuidelineVersion[], fallback: GuidelineVersion): GuidelineVersion {
  // An added version (phase 2) becomes current only when an admin makes it current, so it isn't shown as current.
  return allVersions.filter((version) => !version.neverCurrent).at(-1) ?? fallback
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

/** As the database checks it: https://, sfda.gov.sa or a subdomain (no user name or port), then a path, query or nothing. */
const SFDA_LINK_PATTERN = /^https:\/\/([a-z0-9-]+\.)*sfda\.gov\.sa([/?#]\S*)?$/i

/**
 * An official SFDA link: an https:// link whose host is sfda.gov.sa or one of its subdomains
 * (www.sfda.gov.sa). The host is compared exactly, never with "contains", so look-alikes such as
 * https://sfda.gov.sa.example.com or https://notsfda.gov.sa are refused, and so are a user name or a port.
 */
export function isSfdaLink(value: string): boolean {
  if (!isHttpsLink(value) || !SFDA_LINK_PATTERN.test(value)) return false
  // URL gives the host in lower case, without any user name or port.
  const { hostname } = new URL(value)
  return hostname === 'sfda.gov.sa' || hostname.endsWith('.sfda.gov.sa')
}

/* ---------- Adding a version ---------- */

/** What the admin enters. The PDF itself is uploaded when the version is saved. */
export interface GuidelineVersionInput {
  title: string
  /** Entered by the admin, e.g. "4.1". */
  version: string
  /** When SFDA issued it (ISO date); required. */
  issuedDate: string
  /** Today in Asia/Riyadh when the form opened (ISO date); it can't be changed. */
  addedDate: string
  /** '' when no file was chosen. */
  fileName: string
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
  | 'issued-required'
  | 'issued-after-added'
  | 'added-required'
  | 'file-required'
  | 'file-not-pdf'
  | 'source-required'
  | 'source-invalid'
  | 'source-not-sfda'
  | 'source-too-long'

/**
 * What is wrong with each field (nothing for a valid version). The version number must not be used
 * by any version (`versions`: every version, added ones included) and must be higher than `current`.
 */
export function validateGuidelineVersion(
  input: GuidelineVersionInput,
  versions: GuidelineVersion[],
  current: GuidelineVersion | undefined,
): Partial<Record<GuidelineField, GuidelineProblem>> {
  const title = input.title.trim()
  const version = input.version.trim()
  const fileName = input.fileName.trim()
  const source = input.source.trim()
  return {
    title: !title ? 'title-required' : title.length > TITLE_MAX ? 'title-too-long' : undefined,
    version: !VERSION_PATTERN.test(version)
      ? 'version-invalid'
      : versions.some((item) => VERSION_PATTERN.test(item.version) && compareVersions(item.version, version) === 0)
        ? 'version-exists'
        : current && compareVersions(version, current.version) <= 0
          ? 'version-not-higher'
          : undefined,
    addedDate: input.addedDate ? undefined : 'added-required',
    // ISO dates compare correctly as strings.
    issuedDate: !input.issuedDate
      ? 'issued-required'
      : input.addedDate && input.issuedDate > input.addedDate
        ? 'issued-after-added'
        : undefined,
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

/* ---------- Editing a version ---------- */

/**
 * What can be edited: the title, SFDA issue date and source of every version, and the version number
 * of one that was never current. The added date and the PDF stay (a PDF can only be added where none is).
 */
export type GuidelineEditInput = Pick<GuidelineVersionInput, 'title' | 'version' | 'issuedDate' | 'source'>

/** The Riyadh date a version was added to Hawkim (ISO date), if known. */
export function addedDateOf(version: GuidelineVersion): string {
  return version.addedAt ? riyadhDate(new Date(version.addedAt)) : version.effectiveDate
}

/**
 * What is wrong with an edit: the same rules as adding, for the fields that can change. The version
 * number is checked only for a version that was never current (against the other versions); the
 * issue date can't be after the day the version was added.
 */
export function validateGuidelineEdit(
  input: GuidelineEditInput,
  version: GuidelineVersion,
  versions: GuidelineVersion[],
  current: GuidelineVersion | undefined,
): Partial<Record<GuidelineField, GuidelineProblem>> {
  const problems = validateGuidelineVersion(
    { ...input, version: version.neverCurrent ? input.version : version.version, addedDate: addedDateOf(version), fileName: version.fileName },
    versions.filter((item) => item.id !== version.id),
    current?.id === version.id ? undefined : current,
  )
  return {
    title: problems.title,
    ...(version.neverCurrent ? { version: problems.version } : {}),
    issuedDate: problems.issuedDate,
    source: problems.source,
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
