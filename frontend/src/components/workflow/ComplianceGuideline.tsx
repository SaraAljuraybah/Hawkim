import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { CurrentBadge } from '../ui/CurrentBadge'
import { IconButton } from '../ui/IconButton'
import { adminEn } from '../../content/admin.en'
import { complianceEn } from '../../content/compliance.en'
import { formatDate } from '../../lib/format'
import { addedDateOf } from '../../lib/guidelines'
import { sopGuidelinePath } from '../../lib/routes'
import { useGuidelines } from '../../state/guidelinesContext'

/**
 * The GVP version compliance checks use (the database's current version, never one an admin has
 * added since), as one bordered row: its title, version pill and Current badge, when SFDA issued it
 * and when it was added to Hawkim, and a View button to its read-only page. On the SOP workflow page,
 * before the Compliance Overview's text.
 */
export function ComplianceGuideline({ sopId }: { sopId: string }) {
  const { current } = useGuidelines()
  const navigate = useNavigate()
  const names = adminEn.regulations
  const name = names.versionLabel.replace('{title}', current.title ?? '').replace('{version}', current.version)
  const date = (isoDate: string | undefined): ReactNode => (isoDate ? <time dateTime={isoDate}>{formatDate(isoDate)}</time> : names.none)
  // The dates line's template, split around its two placeholders so the dates can be <time> elements.
  const [beforeIssued, rest] = complianceEn.card.guideline.dates.split('{issued}')
  const [beforeAdded, afterAdded] = rest.split('{added}')

  return (
    <div className="flex items-center gap-4 rounded-lg border border-beige bg-white p-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm font-medium break-words text-maroon">
          <span className="min-w-0">{current.title || names.none}</span>
          <span className="rounded-full bg-beige px-2 py-0.5 text-xs font-medium whitespace-nowrap text-maroon">
            {complianceEn.versionLabel.replace('{version}', current.version)}
          </span>
          <CurrentBadge label={names.current.badge} />
        </p>
        <p className="mt-1 text-sm text-text-gray">
          {beforeIssued}
          {date(current.issuedDate)}
          {beforeAdded}
          {date(current.addedAt ? addedDateOf(current) : undefined)}
          {afterAdded}
        </p>
      </div>
      <IconButton label={names.actions.view.replace('{name}', name)} icon={Eye} onClick={() => navigate(sopGuidelinePath(sopId))} />
    </div>
  )
}
