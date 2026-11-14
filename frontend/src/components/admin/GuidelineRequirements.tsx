import { Button } from '../ui/Button'
import { RequirementsTable } from '../ui/RequirementsTable'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'

/**
 * A GVP version's Requirements section: a table from md, stacked cards below. Hidden, heading
 * included, until the requirements count in the version's details (GuidelineVersionDetails with
 * `actions.requirements`) opens it; `id` is what that count controls. Used on a version's own page
 * (an h2) and in the Current Version card (an h3).
 */
export function GuidelineRequirements({
  version,
  id,
  titleId,
  heading: Heading,
  hidden,
  className = '',
  loading,
}: {
  version: GuidelineVersion
  id: string
  titleId: string
  heading: 'h2' | 'h3'
  hidden: boolean
  className?: string
  /** A published version's passages, read on its page: still being read, or they couldn't be read. */
  loading?: { state: 'loading' | 'failed'; onRetry: () => void }
}) {
  const text = adminEn.regulationDetails.requirements
  if (loading) {
    return (
      <section id={id} aria-labelledby={titleId} hidden={hidden} className={className}>
        <Heading id={titleId} className={Heading === 'h2' ? 'text-lg' : 'text-base'}>
          {text.title}
        </Heading>
        {loading.state === 'loading' ? (
          <p role="status" className="mt-3 text-sm text-text-gray">{text.loading}</p>
        ) : (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-status-rejected-fg">{text.failed}</p>
            <Button variant="secondary" size="sm" onClick={loading.onRetry}>{text.retry}</Button>
          </div>
        )}
      </section>
    )
  }
  return (
    <section id={id} aria-labelledby={titleId} hidden={hidden} className={className}>
      <Heading id={titleId} className={Heading === 'h2' ? 'text-lg' : 'text-base'}>
        {text.title}
      </Heading>
      <RequirementsTable requirements={version.requirements} labels={text} className="mt-3" />
    </section>
  )
}
