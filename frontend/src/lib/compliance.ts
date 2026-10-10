import { SAMPLE_FINDINGS } from '../data/mock/compliance'
import {
  SYSTEM_ACTOR,
  type ComplianceCheck,
  type ComplianceResult,
  type Finding,
  type Guideline,
  type Sop,
} from '../data/mock/types'

/*
 * Compliance checks (PBI 4, 5, 29) as pure functions, like lib/workflow.ts.
 * The SAMPLE engine: a check is "running" for about 3 seconds (the store's
 * timer), then completes with the same sample findings for every SOP.
 * TODO: Replace the sample engine with the compliance service API.
 */

/** How long a sample check stays "running". */
export const SAMPLE_CHECK_DURATION_MS = 3000

/** Result order for sorting and filters: problems first. */
export const RESULT_ORDER: ComplianceResult[] = ['conflict', 'not-addressed', 'partial', 'compliant']

let counter = 0
function newId(prefix: string) {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

// ---------- Reading checks ----------

/** The newest check for the SOP's current version (running, completed or failed), if any. */
export function currentCheck(sop: Sop): ComplianceCheck | undefined {
  return [...sop.complianceChecks].reverse().find((check) => check.version === sop.version)
}

/**
 * Submit and Resubmit need a completed check of the SOP's current version against the
 * CURRENT guideline version (PBI 20, 29). The check doesn't have to pass.
 */
export function hasCurrentCheck(sop: Sop, guidelineVersion: string): boolean {
  const check = currentCheck(sop)
  return check?.status === 'completed' && check.guideline.version === guidelineVersion
}

export function isCheckRunning(sop: Sop): boolean {
  return sop.complianceChecks.some((check) => check.status === 'running')
}

/**
 * The newest completed check of each version, newest version first (the saved reports).
 * Reports of deleted versions are no longer listed.
 */
export function latestCompletedChecksByVersion(sop: Sop): ComplianceCheck[] {
  const deleted = new Set(sop.versions.filter((version) => version.deletedAt).map((version) => version.version))
  const byVersion = new Map<string, ComplianceCheck>()
  for (const check of sop.complianceChecks) {
    if (check.status === 'completed' && !deleted.has(check.version)) byVersion.set(check.version, check)
  }
  return [...byVersion.values()].sort((a, b) => Number(b.version) - Number(a.version))
}

/** Number of findings per result. */
export function countResults(check: ComplianceCheck): Record<ComplianceResult, number> {
  const counts: Record<ComplianceResult, number> = { compliant: 0, partial: 0, conflict: 0, 'not-addressed': 0 }
  for (const finding of check.findings) counts[finding.result] += 1
  return counts
}

/** Conflict first, then Not addressed, Partially compliant and Compliant. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => RESULT_ORDER.indexOf(a.result) - RESULT_ORDER.indexOf(b.result))
}

// ---------- Running checks (sample engine) ----------

/**
 * Starts a check of the SOP's current version against `guideline` (the current GVP
 * version, which the report keeps). Only one check runs at a time: a manual run is
 * refused while one is running, but an upload replaces the running check (it was
 * checking a file that has just been replaced), which leaves no report.
 */
export function startCheck(
  sop: Sop,
  guideline: Guideline,
  { afterUpload = false } = {},
): { sop: Sop; checkId: string } {
  if (isCheckRunning(sop) && !afterUpload) throw new Error('A compliance check is already running')
  const kept = sop.complianceChecks.filter((check) => check.status !== 'running')
  const check: ComplianceCheck = {
    id: newId('chk'),
    sopId: sop.id,
    version: sop.version,
    status: 'running',
    startedAt: new Date().toISOString(),
    guideline,
    findings: [],
  }
  return { sop: { ...sop, complianceChecks: [...kept, check] }, checkId: check.id }
}

/** Ends a running check as completed (with the sample findings) or failed; adds a timeline event by System. */
function finishCheck(sop: Sop, checkId: string, outcome: 'completed' | 'failed'): Sop {
  const check = sop.complianceChecks.find((item) => item.id === checkId)
  // Already finished (e.g. failed from the demo panel before the timer ran): nothing to do.
  if (!check || check.status !== 'running') return sop
  const completedAt = new Date().toISOString()
  const findings =
    outcome === 'completed' ? SAMPLE_FINDINGS.map((finding, index) => ({ ...finding, id: `${checkId}-f${index + 1}` })) : []
  return {
    ...sop,
    complianceChecks: sop.complianceChecks.map((item) =>
      item.id === checkId ? { ...item, status: outcome, completedAt, findings } : item,
    ),
    timeline: [
      ...sop.timeline,
      {
        id: newId('evt'),
        type: outcome === 'completed' ? 'compliance-check-completed' : 'compliance-check-failed',
        actorId: SYSTEM_ACTOR,
        version: check.version,
        createdAt: completedAt,
      },
    ],
  }
}

export function completeCheck(sop: Sop, checkId: string): Sop {
  return finishCheck(sop, checkId, 'completed')
}

/** DEVELOPMENT ONLY (demo panel's "Make the next compliance check fail"): a check that couldn't be completed. */
export function failCheck(sop: Sop, checkId: string): Sop {
  return finishCheck(sop, checkId, 'failed')
}

// ---------- Report details (the compliance report page) ----------

/** A finding with its number in the report ("F-01"), in report order (problems first). */
export interface NumberedFinding extends Finding {
  number: string
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Findings in report order, numbered F-01, F-02… (the numbers don't change with the filter). */
export function numberedFindings(check: ComplianceCheck): NumberedFinding[] {
  return sortFindings(check.findings).map((finding, index) => ({ ...finding, number: `F-${pad2(index + 1)}` }))
}

/** e.g. "CR-SOP-078-v3-01": SOP code, version, and the run number for that version (failed runs included). */
export function reportId(sop: Sop, check: ComplianceCheck): string {
  const run = sop.complianceChecks.filter((item) => item.version === check.version).findIndex((item) => item.id === check.id) + 1
  return `CR-${sop.code}-v${check.version}-${pad2(run)}`
}

/** Compliance score: compliant findings ÷ all findings, as a whole percentage. */
export function complianceScore(check: ComplianceCheck): number {
  if (check.findings.length === 0) return 0
  return Math.round((countResults(check).compliant / check.findings.length) * 100)
}

/** The newest completed report of the nearest earlier version that has one, if any. */
export function previousReport(sop: Sop, check: ComplianceCheck): ComplianceCheck | undefined {
  return latestCompletedChecksByVersion(sop).find((item) => Number(item.version) < Number(check.version))
}

/** How a requirement's result changed between two reports. */
export type ChangeKind = 'resolved' | 'improved' | 'unchanged' | 'worsened' | 'new' | 'removed'

export interface RequirementChange {
  requirementId: string
  before?: ComplianceResult
  after?: ComplianceResult
  kind: ChangeKind
}

/** Better results rank higher: Conflict < Not addressed < Partially compliant < Compliant. */
const RANK: Record<ComplianceResult, number> = { conflict: 0, 'not-addressed': 1, partial: 2, compliant: 3 }

/** Every requirement in either report, by requirement id, with how its result changed. */
export function compareReports(previous: ComplianceCheck, current: ComplianceCheck): RequirementChange[] {
  const ids = [...new Set([...previous.findings, ...current.findings].map((finding) => finding.requirementId))].sort()
  return ids.map((requirementId) => {
    const before = previous.findings.find((finding) => finding.requirementId === requirementId)?.result
    const after = current.findings.find((finding) => finding.requirementId === requirementId)?.result
    let kind: ChangeKind
    if (!before) kind = 'new'
    else if (!after) kind = 'removed'
    else if (before === after) kind = 'unchanged'
    else if (after === 'compliant') kind = 'resolved'
    else kind = RANK[after] > RANK[before] ? 'improved' : 'worsened'
    return { requirementId, before, after, kind }
  })
}

// ---------- Executive summary ----------

/**
 * The report's verdict, from the findings (not from score thresholds): any conflict
 * means action is required; otherwise anything partial or not addressed needs improvement.
 */
export type Verdict = 'fully-compliant' | 'needs-improvement' | 'action-required'

export function verdictOf(check: ComplianceCheck): Verdict {
  const counts = countResults(check)
  if (counts.conflict > 0) return 'action-required'
  if (counts.partial > 0 || counts['not-addressed'] > 0) return 'needs-improvement'
  return 'fully-compliant'
}

/** Better verdicts rank higher (to describe a change as improved or worsened). */
export const VERDICT_RANK: Record<Verdict, number> = { 'action-required': 0, 'needs-improvement': 1, 'fully-compliant': 2 }

/** Up to `limit` findings that need attention, in report order (Conflict, Not addressed, Partially compliant). */
export function topPriorities(findings: NumberedFinding[], limit = 3): NumberedFinding[] {
  return findings.filter((finding) => finding.result !== 'compliant').slice(0, limit)
}
