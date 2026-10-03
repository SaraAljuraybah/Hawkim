import { useState } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { ComplianceSummary, SampleBanner } from '../compliance/ComplianceSummary'
import type { ComplianceContent } from '../../content/types'
import { GVP_GUIDELINE } from '../../data/mock/compliance'
import type { Sop } from '../../data/mock/types'
import { currentCheck } from '../../lib/compliance'
import { formatDateTime } from '../../lib/format'
import { complianceReportPath } from '../../lib/routes'
import { Button } from '../ui/Button'

interface ComplianceCardProps {
  sop: Sop
  content: ComplianceContent
  /** False on published SOPs, where "Recheck compliance" in Actions is the only button. */
  canRun: boolean
  onRun: () => void
}

/**
 * The compliance check of the current version (PBI 4, 5): running, completed
 * (date, version, guideline and counts per result, with a link to the full
 * report), failed, or none yet. The results are sample results for now.
 */
export function ComplianceCard({ sop, content, canRun, onRun }: ComplianceCardProps) {
  const text = content.card
  const check = currentCheck(sop)
  const running = check?.status === 'running'

  // Announce when a running check ends (the new results themselves aren't read out).
  const [wasRunning, setWasRunning] = useState(running)
  const [ended, setEnded] = useState('')
  if (running !== wasRunning) {
    setWasRunning(running)
    setEnded(running ? '' : check?.status === 'failed' ? text.failed : text.completed)
  }

  const runButton = (label: string) =>
    canRun && (
      <Button size="sm" variant="secondary" onClick={onRun}>
        {label}
      </Button>
    )

  return (
    <div>
      <SampleBanner text={content.sampleBanner} />

      <div role="status" className="mt-4">
        {running ? (
          <p className="flex items-center gap-2.5 text-sm font-medium text-maroon">
            <LoaderCircle aria-hidden="true" className="size-5 shrink-0 motion-safe:animate-spin" strokeWidth={2} />
            {text.running.replace('{version}', GVP_GUIDELINE.version)}
          </p>
        ) : (
          <span className="sr-only">{ended}</span>
        )}
      </div>

      {check?.status === 'completed' && (
        <>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_auto_1fr]">
            <div>
              <dt className="text-text-gray">{content.details.checked}</dt>
              <dd className="mt-0.5 font-medium text-maroon">
                <time dateTime={check.completedAt}>{check.completedAt && formatDateTime(check.completedAt)}</time>
              </dd>
            </div>
            <div>
              <dt className="text-text-gray">{content.details.version}</dt>
              <dd className="mt-0.5 font-medium text-maroon">{check.version}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-text-gray">{content.details.guideline}</dt>
              <dd className="mt-0.5 font-medium text-maroon">
                {content.guideline.replace('{name}', check.guideline.name).replace('{version}', check.guideline.version)}
              </dd>
            </div>
          </dl>
          <div className="mt-5">
            <ComplianceSummary check={check} content={content} />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button size="sm" to={complianceReportPath(sop.id)}>
              {text.viewReport}
              <ArrowRight aria-hidden="true" className="size-4" strokeWidth={2} />
            </Button>
            {runButton(text.runAgain)}
          </div>
        </>
      )}

      {check?.status === 'failed' && (
        <div className="rounded-lg border border-status-rejected-fg/25 bg-status-rejected-bg/50 p-4">
          <p className="text-sm font-medium text-status-rejected-fg">{text.failed}</p>
          {canRun && <div className="mt-3">{runButton(text.runAgain)}</div>}
        </div>
      )}

      {!check && (
        <div className="space-y-3">
          <p className="text-sm text-text-gray">{text.none.replace('{version}', sop.version)}</p>
          {runButton(text.run)}
        </div>
      )}
    </div>
  )
}
