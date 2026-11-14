import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import type { ComplianceContent } from '../../content/types'
import type { ComplianceCheck, ComplianceResult } from '../../data/mock/types'
import { complianceScore, countResults, RESULT_ORDER, type NumberedFinding } from '../../lib/compliance'
import { ComplianceBadge } from './ComplianceBadge'
import { FindingText } from './FindingText'
import { requirementLines, sopReferenceLines, sopSectionLabel, withoutContextLabel } from './findingDetails'
import { overviewCells } from './overviewCells'
import { useReportRequirement } from './reportRequirements'

/** Indicator colours per result (the darker status tokens, so they stand out on white). */
const SEGMENT: Record<ComplianceResult, string> = {
  conflict: 'bg-status-rejected-fg',
  'not-addressed': 'bg-status-cancelled-fg',
  partial: 'bg-status-pending-fg',
  compliant: 'bg-status-approved-fg',
}

/**
 * A report section: a card with an h2 (and a short description under it, if given), kept on one page
 * when printed (so a heading is never left alone).
 */
export function ReportSection({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-6 rounded-xl border border-beige bg-white p-5 break-inside-avoid sm:p-6 print:mt-5 print:border-0 print:p-0">
      <h2 id={id} className={description ? 'text-lg' : 'mb-4 text-lg'}>
        {title}
      </h2>
      {description && <p className="mt-1 mb-4 text-sm text-text-gray">{description}</p>}
      {children}
    </section>
  )
}

// ---------- b) Summary ----------

const RING_RADIUS = 52
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

/** Circular score: maroon arc on a beige track, the percentage in the centre (fills in unless motion is reduced). */
function ScoreRing({ score, label, caption }: { score: number; label: string; caption: string }) {
  const offset = RING_LENGTH * (1 - score / 100)
  return (
    <div role="img" aria-label={label} className="relative size-44 shrink-0 print:size-40">
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
        <span className="text-4xl leading-none font-semibold tracking-tight text-maroon">{score}%</span>
        <span className="mt-1 text-xs font-medium text-text-gray">{caption}</span>
      </div>
    </div>
  )
}

/**
 * The Summary: what the score means (full width), then the score ring with a 2×2 square of tiles,
 * one per result, beside it (stacked on phones; one tile per row when even two don't fit). The
 * tiles only show the counts (0 too); they aren't links or buttons.
 */
export function ExecutiveSummary({ check, content }: { check: ComplianceCheck; content: ComplianceContent }) {
  const text = content.report.summary
  const counts = countResults(check)
  const total = check.findings.length
  const score = complianceScore(check)

  return (
    <div>
      {/* a) What the score means */}
      <p className="text-[0.9375rem] text-maroon">{text.scoreNote}</p>

      {/* b) The ring, with the tiles beside it from sm (and when printed); stacked on phones */}
      <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8 print:flex-row print:items-center print:gap-6">
        <ScoreRing
          score={score}
          label={text.ringLabel
            .replace('{score}', String(score))
            .replace('{count}', String(counts.compliant))
            .replace('{total}', String(total))}
          caption={text.ringCaption}
        />
        {/* Problems first, two per row: Conflict and Requires Human Review, then Partially Compliant and Compliant. 0 is shown but muted. */}
        <div className="@container min-w-0 flex-1">
          <ul aria-label={text.tilesLabel} className="grid grid-cols-1 gap-2.5 @2xs:grid-cols-2">
            {RESULT_ORDER.map((result) => {
              const muted = counts[result] === 0
              return (
                <li key={result} className="flex">
                  <div className="w-full rounded-lg border border-beige p-3">
                    <span
                      aria-hidden="true"
                      data-print-color
                      className={`block h-1.5 w-6 rounded-full [print-color-adjust:exact] ${muted ? 'bg-beige' : SEGMENT[result]}`}
                    />
                    <span className={`mt-2 block text-xl leading-none font-semibold tabular-nums ${muted ? 'text-text-gray' : 'text-maroon'}`}>
                      {counts[result]}
                    </span>
                    <span className={`mt-1 block text-sm ${muted ? 'text-text-gray' : 'text-maroon'}`}>{content.results[result]}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}

// ---------- c) Requirements overview ----------

export function RequirementsOverview({
  findings,
  stepsChecked,
  content,
  onJump,
}: {
  findings: NumberedFinding[]
  /** How many SOP procedures the compliance service checked; undefined for sample results. */
  stepsChecked?: number
  content: ComplianceContent
  /** Shows the finding (switching the filter to All if needed) and moves focus to it. */
  onJump: (event: MouseEvent<HTMLAnchorElement>, number: string) => void
}) {
  const text = content.report.overview
  const getRequirement = useReportRequirement()
  const procedures =
    stepsChecked === undefined
      ? text.procedures.unknown
      : (stepsChecked === 1 ? text.procedures.one : text.procedures.other).replace('{count}', String(stepsChecked))
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
      {/* Right under the section's title */}
      <p className="-mt-3 mb-4 text-sm text-maroon">{procedures}</p>

      {/* Table from sm (and when printed) */}
      <table className="hidden w-full text-left text-sm sm:table print:table">
        <thead>
          <tr className="border-b border-beige text-text-gray">
            <th scope="col" className="py-2 pr-4 font-medium">
              {text.findingId}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              {text.requirementTitle}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              {text.requirementReference}
            </th>
            <th scope="col" className="py-2 font-medium">
              {text.result}
            </th>
          </tr>
        </thead>
        <tbody>
          {findings.map((finding) => {
            const { title, reference } = overviewCells(content.report, finding.requirementId, getRequirement)
            return (
              <tr key={finding.id} className="border-b border-beige last:border-0 break-inside-avoid">
                <td className="py-2.5 pr-4 whitespace-nowrap">{link(finding)}</td>
                <td className="py-2.5 pr-4 text-maroon">{title}</td>
                <td className="py-2.5 pr-4 whitespace-nowrap text-maroon">{reference}</td>
                <td className="py-2.5">
                  <ComplianceBadge result={finding.result} labels={content.results} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Stacked list on phones */}
      <ul className="divide-y divide-beige sm:hidden print:hidden">
        {findings.map((finding) => {
          const { title, reference } = overviewCells(content.report, finding.requirementId, getRequirement)
          return (
            <li key={finding.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                {link(finding)}
                <ComplianceBadge result={finding.result} labels={content.results} />
              </div>
              <p className="mt-1 text-sm text-maroon">{title}</p>
              <p className="mt-0.5 text-sm text-text-gray">{text.referenceLine.replace('{reference}', reference)}</p>
            </li>
          )
        })}
      </ul>
    </>
  )
}

// ---------- d) Findings ----------

/** A quoted text (the requirement, the SOP's): a gold left border, grey when printed (index.css). */
const QUOTE = 'border-l-2 border-gold pl-3'

export function FindingCard({ finding, content }: { finding: NumberedFinding; content: ComplianceContent }) {
  const text = content.report.findings
  const requirement = useReportRequirement()(finding.requirementId)
  const headingId = `finding-${finding.number}-title`
  const lines = requirement && requirementLines(requirement, text.none)
  const sopLines = finding.sopReference ? sopReferenceLines(finding.sopReference, finding.sopEvidence, text) : undefined
  const quotes = finding.sopEvidence ?? []
  /** A "Label: value" line, styled like the Module, Section and Page lines. */
  const line = (label: string, value: string) => (
    <div key={label}>
      <dt className="inline">{label}</dt> <dd className="inline">{value}</dd>
    </div>
  )

  return (
    <article
      id={`finding-${finding.number}`}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="scroll-mt-24 rounded-xl border border-beige bg-white p-5 break-inside-avoid sm:p-6 print:p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h4 id={headingId} className="text-base font-semibold text-maroon">
          {text.heading.replace('{number}', finding.number)}
        </h4>
        <ComplianceBadge result={finding.result} labels={content.results} />
      </div>
      <dl className="mt-4 space-y-3 text-sm">
        {/* Module, Section and Page of the requirement, one per line */}
        {lines && (
          <div>
            <dt className="font-medium text-maroon">{text.requirementReference}</dt>
            <dd className="mt-0.5">
              <dl className="space-y-0.5 text-maroon">
                {line(text.module, lines.module)}
                {line(text.section, lines.section)}
                {line(text.page, lines.page)}
              </dl>
            </dd>
          </div>
        )}
        {requirement && (
          <div>
            <dt className="font-medium text-maroon">{text.requirement}</dt>
            <dd className="mt-0.5">
              <blockquote className={`${QUOTE} break-inside-avoid`}>
                <FindingText text={withoutContextLabel(requirement.summary)} className="text-[0.9375rem] text-maroon" />
              </blockquote>
            </dd>
          </div>
        )}
        {/* Section and Page of the SOP: one section on two lines, several as a list ("Section: … · Page: …") */}
        <div>
          <dt className="font-medium text-maroon">{text.sopReference}</dt>
          <dd className="mt-0.5">
            {sopLines?.length === 1 ? (
              <dl className="space-y-0.5 text-maroon">
                {line(text.section, sopLines[0].section)}
                {sopLines[0].page !== undefined && line(text.page, String(sopLines[0].page))}
              </dl>
            ) : sopLines && sopLines.length > 1 ? (
              <ul className="list-disc space-y-1 pl-5 text-maroon">
                {sopLines.map((item) => (
                  <li key={`${item.section}-${item.page}`}>
                    {`${text.section} ${item.section}${item.page === undefined ? '' : `${text.lineSeparator}${text.page} ${item.page}`}`}
                  </li>
                ))}
              </ul>
            ) : (
              <FindingText text={finding.sopReference ?? text.noSopReference} className="text-text-gray" />
            )}
          </dd>
        </div>
        {/* The SOP sentences the result is based on, quoted; labelled with their section only when there are several */}
        {quotes.length > 0 && (
          <div>
            <dt className="font-medium text-maroon">{text.sopText}</dt>
            <dd className="mt-0.5 space-y-3">
              {quotes.map((item, index) => (
                <figure key={index} className="break-inside-avoid">
                  {quotes.length > 1 && <figcaption className="text-text-gray">{sopSectionLabel(item.section, text)}</figcaption>}
                  <blockquote className={quotes.length > 1 ? `mt-1 ${QUOTE}` : QUOTE}>
                    <FindingText text={item.text} className="text-[0.9375rem] text-maroon" />
                  </blockquote>
                </figure>
              ))}
            </dd>
          </div>
        )}
        <div className="rounded-lg bg-beige/60 px-4 py-3 print:px-0 print:py-0">
          <dt className="font-medium text-maroon">{text.justification}</dt>
          <dd className="mt-0.5">
            <FindingText text={finding.justification} className="text-maroon" />
          </dd>
        </div>
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
