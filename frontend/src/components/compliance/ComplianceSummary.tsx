import { Info } from 'lucide-react'
import type { ComplianceContent } from '../../content/types'
import type { ComplianceCheck } from '../../data/mock/types'
import { countResults, RESULT_ORDER } from '../../lib/compliance'
import { ComplianceBadge } from './ComplianceBadge'

/** "Sample results — the compliance service isn't connected yet." */
export function SampleBanner({ text, className = '' }: { text: string; className?: string }) {
  return (
    <p className={`flex items-start gap-2 rounded-lg border border-maroon/15 bg-beige px-3.5 py-2.5 text-sm text-maroon ${className}`}>
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
      {text}
    </p>
  )
}

/** "2 of 5 requirements compliant" and the number of findings per result (problems first). */
export function ComplianceSummary({ check, content }: { check: ComplianceCheck; content: ComplianceContent }) {
  const counts = countResults(check)
  return (
    <div>
      <p className="font-semibold text-maroon">
        {content.summary.replace('{count}', String(counts.compliant)).replace('{total}', String(check.findings.length))}
      </p>
      <ul aria-label={content.countsLabel} className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {RESULT_ORDER.map((result) => (
          <li key={result} className="flex items-center gap-2">
            <ComplianceBadge result={result} labels={content.results} />
            <span className="text-sm font-semibold text-maroon tabular-nums">{counts[result]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
