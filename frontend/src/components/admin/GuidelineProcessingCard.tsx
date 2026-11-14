import { useState } from 'react'
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react'
import { Button } from '../ui/Button'
import { ProcessingStatusBadge } from '../ui/ProcessingStatusBadge'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'

const text = adminEn.regulationDetails.processing

interface GuidelineProcessingCardProps {
  version: GuidelineVersion
  /** Processes the version again after processing failed. */
  onRetry: () => Promise<void>
  /** Makes the version current; resolves after it is current. */
  onMakeCurrent: () => Promise<void>
}

/**
 * GVP phase 2, on an added version's page: whether the compliance service has processed its PDF
 * (requirements split and embedded), what it found, and Make Current once it is ready, or Try Again
 * after a failure. The page reads the added versions again while the version is being processed.
 */
export function GuidelineProcessingCard({ version, onRetry, onMakeCurrent }: GuidelineProcessingCardProps) {
  const processing = version.processing
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!processing) return null

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      await action()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  const spinner = busy && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />
  const report = processing.report

  return (
    <section aria-labelledby="guideline-processing-title" className="mt-6 rounded-xl border border-beige bg-white p-5 sm:p-6">
      {/* The status label is the heading, as in the versions list; screen readers hear "Status: Waiting". */}
      <h2 id="guideline-processing-title" className="mb-4">
        <span className="sr-only">{text.title}: </span>
        <ProcessingStatusBadge status={processing.status} size="lg" />
      </h2>
      <div role="status" className="space-y-3 text-sm text-maroon">
        <p className="flex items-start gap-2">
          {processing.status === 'ready' && <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-approved-fg" strokeWidth={2} />}
          {processing.status === 'failed' && <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-rejected-fg" strokeWidth={2} />}
          {(processing.status === 'waiting' || processing.status === 'processing') && (
            <LoaderCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-gray motion-safe:animate-spin" strokeWidth={1.75} />
          )}
          <span>{text.status[processing.status]}</span>
        </p>
        {processing.status === 'processing' && <ProcessingProgress progress={processing.progress} />}
        {(processing.status === 'waiting' || processing.status === 'processing') && (
          <p className="text-text-gray">{text.keepWorking}</p>
        )}
        {processing.status === 'failed' && processing.error && <p className="text-status-rejected-fg">{processing.error}</p>}
        {report && (
          <p>
            {text.report.replace('{requirements}', report.requirements.toLocaleString('en-US')).replace('{sections}', report.sections.toLocaleString('en-US'))}
            {report.pages ? ` · ${text.pages.replace('{pages}', report.pages.toLocaleString('en-US'))}` : ''}
          </p>
        )}
        {report && (report.warnings.length > 0 || report.missingExcludedSections.length > 0) && (
          <div>
            <p className="font-medium">{text.warningsTitle}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-text-gray">
              {report.missingExcludedSections.length > 0 && (
                <li>{text.missingExcluded.replace('{sections}', report.missingExcludedSections.join(', '))}</li>
              )}
              {report.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        )}
        {failed && <p role="alert" className="text-status-rejected-fg">{text.failedAction}</p>}
      </div>

      {processing.status === 'failed' && (
        <div className="mt-4">
          <Button variant="secondary" aria-disabled={busy || undefined} onClick={() => run(onRetry)}>
            {spinner}
            {text.retry}
          </Button>
        </div>
      )}
      {processing.status === 'ready' && !confirming && (
        <div className="mt-4">
          <Button onClick={() => setConfirming(true)}>{text.makeCurrent}</Button>
        </div>
      )}
      {processing.status === 'ready' && confirming && (
        <div className="mt-4 space-y-3 rounded-lg bg-beige/60 px-4 py-3">
          <p className="text-sm text-maroon">{text.confirm.replace('{version}', version.version)}</p>
          <div className="flex flex-wrap gap-3">
            <Button aria-disabled={busy || undefined} onClick={() => run(onMakeCurrent)}>
              {spinner}
              {text.confirmAction.replace('{version}', version.version)}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>{text.cancel}</Button>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * The overall progress of processing, across all its stages, as a bar and as text
 * ("Preparing requirements: batch 32 of 186 (28%)"); 0% before the service reported any.
 */
function ProcessingProgress({ progress }: { progress: NonNullable<GuidelineVersion['processing']>['progress'] }) {
  const percent = Math.min(Math.max(progress?.percent ?? 0, 0), 100)
  const stage = progress?.stage ?? text.progress.starting
  const label = (progress?.detail ? text.progress.withDetail : text.progress.withoutDetail)
    .replace('{stage}', stage).replace('{detail}', progress?.detail ?? '').replace('{percent}', String(percent))
  return (
    <div>
      <p>{label}</p>
      <div
        role="progressbar"
        aria-label={text.progress.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={label}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-beige"
      >
        <div className="h-full rounded-full bg-maroon transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
