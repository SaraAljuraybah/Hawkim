import { GVP_GUIDELINE, SAMPLE_FINDINGS } from '../data/mock/compliance'
import { SYSTEM_ACTOR, type ComplianceCheck, type ComplianceResult, type Finding, type Sop } from '../data/mock/types'

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

/** Submit and Resubmit need a completed check for the current version (it doesn't have to pass). */
export function hasCompletedCheck(sop: Sop): boolean {
  return currentCheck(sop)?.status === 'completed'
}

export function isCheckRunning(sop: Sop): boolean {
  return sop.complianceChecks.some((check) => check.status === 'running')
}

/** The newest completed check of each version, newest version first (the saved reports). */
export function latestCompletedChecksByVersion(sop: Sop): ComplianceCheck[] {
  const byVersion = new Map<string, ComplianceCheck>()
  for (const check of sop.complianceChecks) if (check.status === 'completed') byVersion.set(check.version, check)
  return [...byVersion.values()].reverse()
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

/** Starts a check of the current version. Only one check runs at a time. */
export function startCheck(sop: Sop): { sop: Sop; checkId: string } {
  if (isCheckRunning(sop)) throw new Error('A compliance check is already running')
  const check: ComplianceCheck = {
    id: newId('chk'),
    sopId: sop.id,
    version: sop.version,
    status: 'running',
    startedAt: new Date().toISOString(),
    guideline: GVP_GUIDELINE,
    findings: [],
  }
  return { sop: { ...sop, complianceChecks: [...sop.complianceChecks, check] }, checkId: check.id }
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

/** DEVELOPMENT ONLY (demo panel): simulates a check that couldn't be completed. */
export function failCheck(sop: Sop, checkId: string): Sop {
  return finishCheck(sop, checkId, 'failed')
}
