import type { MouseEvent, ReactNode } from 'react'
import type { ComplianceContent } from '../../content/types'
import { getRequirement } from '../../data/mock/compliance'
import type { ComplianceCheck, ComplianceResult } from '../../data/mock/types'
import type { SopStatus } from '../../types/status'
import {
  complianceScore,
  countResults,
  RESULT_ORDER,
  type NumberedFinding,
  type RequirementChange,
} from '../../lib/compliance'
import { ComplianceBadge } from './ComplianceBadge'

type ReportText = ComplianceContent['report']

/** Bar and legend colours per result (the darker status tokens, so segments stand out on white). */
const SEGMENT: Record<ComplianceResult, string> = {
  conflict: 'bg-status-rejected-fg',
  'not-addressed': 'bg-status-cancelled-fg',
  partial: 'bg-status-pending-fg',
  compliant: 'bg-status-approved-fg',
}

/** A report section: a card with an h2, kept on one page when printed (so a heading is never left alone). */
export function ReportSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-6 rounded-xl border border-beige bg-white p-5 break-inside-avoid sm:p-6 print:mt-5 print:border-0 print:p-0">
      <h2 id={id} className="mb-4 text-lg">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** "R2 · I.B.10 Record management" */
function requirementLabel(text: ReportText, requirementId: string): string {
  const requirement = getRequirement(requirementId)
  if (!requirement) return requirementId
  return text.overview.requirementLabel
    .replace('{id}', requirement.id)
    .replace('{section}', requirement.section)
    .replace('{title}', requirement.sectionTitle)
}

// ---------- b) Executive summary ----------

/** "1 conflict, 1 requirement not addressed and 1 partially compliant requirement need attention before submitting for review." */
function summarySentence(check: ComplianceCheck, status: SopStatus, text: ReportText['summary']): string {
  const counts = countResults(check)
  const keys = ['conflict', 'not-addressed', 'partial'] as const
  const parts = keys
    .filter((key) => counts[key] > 0)
    .map((key) => (counts[key] === 1 ? text.attention[key].one : text.attention[key].other).replace('{count}', String(counts[key])))
  if (parts.length === 0) return text.allCompliant
  const items = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} ${text.and} ${parts[parts.length - 1]}`
  const total = keys.reduce((sum, key) => sum + counts[key], 0)
  // "…before submitting for review" only while the author can still (re)submit.
  const template = status === 'draft' || status === 'returned' ? text.beforeSubmit : text.needsAttention
  return (total === 1 ? template.one : template.other).replace('{items}', items)
}

export function ExecutiveSummary({
  check,
  status,
  content,
}: {
  check: ComplianceCheck
  status: SopStatus
  content: ComplianceContent
}) {
  const text = content.report.summary
  const counts = countResults(check)
  const total = check.findings.length
  const parts = RESULT_ORDER.map((result) =>
    text.barPart.replace('{label}', content.results[result]).replace('{count}', String(counts[result])),
  ).join(', ')

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <p className="text-4xl leading-none font-semibold tracking-tight text-maroon">
          {text.score.replace('{score}', String(complianceScore(check)))}
        </p>
        <p className="font-semibold text-maroon">
          {content.summary.replace('{count}', String(counts.compliant)).replace('{total}', String(total))}
        </p>
      </div>
      <p className="mt-2 text-sm text-text-gray">{text.scoreNote}</p>

      {/* Stacked bar: decorative colours, with a text alternative and a text legend */}
      <div
        role="img"
        aria-label={text.barLabel.replace('{parts}', parts)}
        className="mt-5 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-beige [print-color-adjust:exact]"
      >
        {RESULT_ORDER.filter((result) => counts[result] > 0).map((result) => (
          <span
            key={result}
            data-print-color
            className={`h-full ${SEGMENT[result]}`}
            style={{ width: `${(counts[result] / total) * 100}%` }}
          />
        ))}
      </div>
      <ul aria-label={text.legendLabel} className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-maroon">
        {RESULT_ORDER.map((result) => (
          <li key={result} className="flex items-center gap-2">
            <span aria-hidden="true" data-print-color className={`size-3 rounded-sm [print-color-adjust:exact] ${SEGMENT[result]}`} />
            {content.results[result]}
            <span className="font-semibold tabular-nums">{counts[result]}</span>
          </li>
        ))}
      </ul>

      <p className="mt-5 rounded-lg bg-beige/60 px-4 py-3 text-[0.9375rem] text-maroon">{summarySentence(check, status, text)}</p>
    </div>
  )
}

// ---------- c) Requirements overview ----------

export function RequirementsOverview({
  findings,
  content,
  onJump,
}: {
  findings: NumberedFinding[]
  content: ComplianceContent
  /** Shows the finding (switching the filter to All if needed) and moves focus to it. */
  onJump: (event: MouseEvent<HTMLAnchorElement>, number: string) => void
}) {
  const text = content.report.overview
  const link = (finding: NumberedFinding) => (
    <a
      href={`#finding-${finding.number}`}
      onClick={(event) => onJump(event, finding.number)}
      className="rounded-sm font-semibold text-maroon underline underline-offset-2 hover:text-maroon-secondary"
    >
      {finding.number}
    </a>
  )

  return (
    <>
      {/* Table from sm (and when printed) */}
      <table className="hidden w-full text-left text-sm sm:table print:table">
        <thead>
          <tr className="border-b border-beige text-text-gray">
            <th scope="col" className="py-2 pr-4 font-medium">
              {text.findingId}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              {text.requirement}
            </th>
            <th scope="col" className="py-2 font-medium">
              {text.result}
            </th>
          </tr>
        </thead>
        <tbody>
          {findings.map((finding) => (
            <tr key={finding.id} className="border-b border-beige last:border-0 break-inside-avoid">
              <td className="py-2.5 pr-4 whitespace-nowrap">{link(finding)}</td>
              <td className="py-2.5 pr-4 text-maroon">{requirementLabel(content.report, finding.requirementId)}</td>
              <td className="py-2.5">
                <ComplianceBadge result={finding.result} labels={content.results} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Stacked list on phones */}
      <ul className="divide-y divide-beige sm:hidden print:hidden">
        {findings.map((finding) => (
          <li key={finding.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              {link(finding)}
              <ComplianceBadge result={finding.result} labels={content.results} />
            </div>
            <p className="mt-1 text-sm text-maroon">{requirementLabel(content.report, finding.requirementId)}</p>
          </li>
        ))}
      </ul>
    </>
  )
}

// ---------- d) Findings ----------

export function FindingCard({ finding, content }: { finding: NumberedFinding; content: ComplianceContent }) {
  const text = content.report.findings
  const requirement = getRequirement(finding.requirementId)
  const headingId = `finding-${finding.number}-title`

  return (
    <article
      id={`finding-${finding.number}`}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="scroll-mt-24 rounded-xl border border-beige bg-white p-5 break-inside-avoid sm:p-6 print:p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h4 id={headingId} className="text-base font-semibold text-maroon">
          {text.heading.replace('{number}', finding.number).replace('{requirement}', finding.requirementId)}
        </h4>
        <ComplianceBadge result={finding.result} labels={content.results} />
      </div>
      {requirement && (
        <>
          <p className="mt-2 text-sm text-text-gray">
            {text.requirementReference
              .replace('{module}', requirement.module)
              .replace('{section}', requirement.section)
              .replace('{title}', requirement.sectionTitle)
              .replace('{page}', String(requirement.page))}
          </p>
          <p className="mt-2 text-[0.9375rem] text-maroon">{requirement.summary}</p>
        </>
      )}
      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="font-medium text-maroon">{text.sopReference}</dt>
          <dd className="mt-0.5 text-text-gray">{finding.sopReference ?? text.noSopReference}</dd>
        </div>
        <div className="rounded-lg bg-beige/60 px-4 py-3 print:px-0 print:py-0">
          <dt className="font-medium text-maroon">{text.justification}</dt>
          <dd className="mt-0.5 text-maroon">{finding.justification}</dd>
        </div>
        {finding.recommendedAction && (
          <div>
            <dt className="font-medium text-maroon">{text.recommendedAction}</dt>
            <dd className="mt-0.5 text-maroon">{finding.recommendedAction}</dd>
          </div>
        )}
      </dl>
    </article>
  )
}

/** A titled group of finding cards (h3 over the h4 findings). */
export function FindingGroup({
  id,
  title,
  findings,
  content,
}: {
  id: string
  title: string
  findings: NumberedFinding[]
  content: ComplianceContent
}) {
  return (
    <section aria-labelledby={id} className="mt-6 first:mt-0">
      <h3 id={id} className="text-base font-semibold text-maroon">
        {title} <span className="font-normal text-text-gray">({findings.length})</span>
      </h3>
      {findings.length === 0 ? (
        <p className="mt-3 text-sm text-text-gray">{content.report.findings.empty}</p>
      ) : (
        <div className="mt-3 space-y-4">
          {findings.map((finding) => (
            <FindingCard key={finding.id} finding={finding} content={content} />
          ))}
        </div>
      )}
    </section>
  )
}

// ---------- e) Changes since the previous version ----------

export function ChangesList({
  changes,
  previousLabel,
  content,
}: {
  changes: RequirementChange[]
  /** "Compared with the report for version 1.1 (CR-SOP-078-1.1-01)." */
  previousLabel: string
  content: ComplianceContent
}) {
  const text = content.report.changes
  const result = (value?: ComplianceResult) => (value ? content.results[value] : '—')
  return (
    <>
      <p className="text-sm text-text-gray">{previousLabel}</p>
      <ul className="mt-3 divide-y divide-beige text-sm">
        {changes.map((change) => (
          <li key={change.requirementId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2.5 first:pt-0 last:pb-0">
            <span className="font-medium text-maroon">{requirementLabel(content.report, change.requirementId)}</span>
            <span className="text-maroon">
              {change.kind === 'new' ? (
                result(change.after)
              ) : change.kind === 'removed' ? (
                result(change.before)
              ) : (
                <>
                  {result(change.before)} <span aria-hidden="true">→</span>
                  <span className="sr-only"> {text.changedTo} </span> {result(change.after)}
                </>
              )}
            </span>
            <span className="text-text-gray">({text.kinds[change.kind]})</span>
          </li>
        ))}
      </ul>
    </>
  )
}
