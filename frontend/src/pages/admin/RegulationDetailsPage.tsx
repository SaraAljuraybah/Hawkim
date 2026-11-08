import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { CurrentBadge } from '../../components/ui/CurrentBadge'
import { GuidelineVersionView } from '../../components/ui/GuidelineVersionView'
import { adminEn } from '../../content/admin.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { newestVersion } from '../../lib/guidelines'
import { useGuidelines } from '../../state/guidelinesContext'
import { NotFoundPage } from '../NotFoundPage'

/**
 * A GVP version ("/admin/regulations/:id", PBI 20): its details; its requirements, shown from the
 * details' count; and its PDF in a card of its own, through a signed link, when it has one
 * (GuidelineVersionView). The newest version shows the Current badge, as on the SFDA Regulatory
 * Requirements tab (display only).
 */
export function RegulationDetailsPage() {
  const { id } = useParams()
  const text = adminEn.regulationDetails
  const names = adminEn.regulations
  const { getVersion, current, allVersions } = useGuidelines()
  const version = getVersion(id)
  const shownCurrent = newestVersion(allVersions, current)
  const name = version ? names.versionName.replace('{version}', version.version) : ''
  useDocumentTitle(version ? adminEn.pageTitle.replace('{page}', name) : undefined)

  if (!version) return <NotFoundPage embedded />

  return (
    <>
      <Link
        to={text.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {text.back.label}
      </Link>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl tracking-tight sm:text-3xl">{name}</h1>
        {version.id === shownCurrent.id && <CurrentBadge label={names.current.badge} />}
      </div>

      {/* A new view for each version, so the requirements start closed */}
      <GuidelineVersionView key={version.id} version={version} />
    </>
  )
}
