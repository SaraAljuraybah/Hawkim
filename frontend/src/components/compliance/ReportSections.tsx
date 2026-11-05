import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { CircleCheck, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ComplianceContent } from '../../content/types'
import type { ComplianceCheck, ComplianceResult, Requirement } from '../../data/mock/types'
import type { SopStatus } from '../../types/status'
import {
  complianceScore,
  countResults,
  RESULT_ORDER,
  verdictOf,
  type NumberedFinding,
  type Verdict,
} from '../../lib/compliance'
import { ComplianceBadge } from './ComplianceBadge'
import { useReportRequirement } from './reportRequirements'
import { summarySentence } from './summarySentence'

type ReportText = ComplianceContent['report']

/** Indicator colours per result (the darker status tokens, so they stand out on white). */
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
function requirementLabel(
  text: ReportText,
  requirementId: string,
  getRequirement: (id: string) => Requirement | undefined,
): string {
  const requirement = getRequirement(requirementId)
  if (!requirement) return requirementId
  return text.overview.requirementLabel
    .replace('{id}', requirement.id)
    .replace('{section}', requirement.section)
    .replace('{title}', requirement.sectionTitle)
}

// ---------- b) Executive summary ----------

/** The verdict's colours (the status colour pairs, all WCAG AA) and icon. */
const VERDICT_STYLE: Record<Verdict, { classes: string; Icon: LucideIcon }> = {
  'fully-compliant': { classes: 'bg-status-approved-bg text-status-approved-fg', Icon: CircleCheck },
  'needs-improvement': { classes: 'bg-status-pending-bg text-status-pending-fg', Icon: TriangleAlert },
  'action-required': { classes: 'bg-status-rejected-bg text-status-rejected-fg', Icon: OctagonAlert },
}

const RING_RADIUS = 52
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

/** Circular score: maroon arc on a beige track, the percentage in the centre (fills in unless motion is reduced). */
function ScoreRing({ score, label, caption }: { score: number; label: string; caption: string }) {
  const offset = RING_LENGTH * (1 - score / 100)
  return (
    <div role="img" aria-label={label} className="relative size-36 shrink-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={RING_RADIUS} fill="none" strokeWidth="12" className="stroke-beige" data-print-color />
        {score > 0 && (
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={offset}
            data-print-color
            className="stroke-maroon motion-safe:animate-[ring-fill_900ms_ease-out]"
            style={{ '--ring-length': `${RING_LENGTH}px` } as CSSProperties}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl leading-none font-semibold tracking-tight text-maroon">{score}%</span>
        <span className="mt-1 text-xs font-medium text-text-gray">{caption}</span>
      </div>
    </div>
  )
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
  const score = complianceScore(check)
  const verdict = verdictOf(check)
  const { classes, Icon } = VERDICT_STYLE[verdict]
  const toAttention = counts.partial + counts['not-addressed']
  const explanation =
    verdict === 'action-required'
      ? (counts.conflict === 1 ? text.explanation.actionRequired.one : text.explanation.actionRequired.other).replace(
          '{count}',
          String(counts.conflict),
        )
      : verdict === 'needs-improvement'
        ? (toAttention === 1 ? text.explanation.needsImprovement.one : text.explanation.needsImprovement.other).replace(
            '{count}',
            String(toAttention),
          )
        : text.allCompliant

  return (
    <div>
      {/* a) Score and verdict */}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8">
        <ScoreRing
          score={score}
          label={text.ringLabel
            .replace('{score}', String(score))
            .replace('{count}', String(counts.compliant))
            .replace('{total}', String(total))}
          caption={text.ringCaption}
        />
        <div className="min-w-0 flex-1">
          <p
            data-print-color
            className={`inline-flex items-center gap-2 rounded-full border border-current/20 px-3 py-1 text-sm font-semibold [print-color-adjust:exact] ${classes}`}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.25} />
            {text.verdicts[verdict]}
          </p>
          <p className="mt-2 text-[0.9375rem] font-medium text-maroon">{explanation}</p>
          <p className="mt-1 text-sm text-text-gray">
            {content.summary.replace('{count}', String(counts.compliant)).replace('{total}', String(total))}
          </p>
          <p className="mt-2 text-sm text-text-gray">{text.scoreNote}</p>
        </div>
      </div>

      {/* The summary sentence (not repeated when everything is compliant) */}
      {verdict !== 'fully-compliant' && (
        <p className="mt-5 rounded-lg bg-beige/60 px-4 py-3 text-[0.9375rem] text-maroon">{summarySentence(check, status, text)}</p>
      )}

      {/* b) Metric tiles (problems first); 0 is shown but muted */}
      <ul aria-label={text.tilesLabel} className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {RESULT_ORDER.map((result) => {
          const muted = counts[result] === 0
          return (
            <li key={result} className="rounded-lg border border-beige p-3.5">
              <span
                aria-hidden="true"
                data-print-color
                className={`block h-1.5 w-8 rounded-full [print-color-adjust:exact] ${muted ? 'bg-beige' : SEGMENT[result]}`}
              />
              <p className={`mt-2.5 text-2xl leading-none font-semibold tabular-nums ${muted ? 'text-text-gray' : 'text-maroon'}`}>
                {counts[result]}
              </p>
              <p className={`mt-1 text-sm ${muted ? 'text-text-gray' : 'text-maroon'}`}>{content.results[result]}</p>
            </li>
          )
        })}
      </ul>
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
  const getRequirement = useReportRequirement()
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
              <td className="py-2.5 pr-4 text-maroon">{requirementLabel(content.report, finding.requirementId, getRequirement)}</td>
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
            <p className="mt-1 text-sm text-maroon">{requirementLabel(content.report, finding.requirementId, getRequirement)}</p>
          </li>
        ))}
      </ul>
    </>
  )
}

// ---------- d) Findings ----------

export function FindingCard({ finding, content }: { finding: NumberedFinding; content: ComplianceContent }) {
  const text = content.report.findings
  const requirement = useReportRequirement()(finding.requirementId)
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
