import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { GuidelineProcessingCard } from '../../components/admin/GuidelineProcessingCard'
import { CurrentBadge } from '../../components/ui/CurrentBadge'
import { ProcessingStatusBadge } from '../../components/ui/ProcessingStatusBadge'
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
 * Requirements tab (display only). An added version also shows its processing card (phase 2).
 */
export function RegulationDetailsPage() {
  const { id } = useParams()
  const text = adminEn.regulationDetails
  const names = adminEn.regulations
  const { getVersion, current, allVersions, retryProcessing, makeCurrent } = useGuidelines()
  const navigate = useNavigate()
  const version = getVersion(id)
  const shownCurrent = newestVersion(allVersions, current)
  const name = version ? names.versionName.replace('{version}', version.version) : ''
  useDocumentTitle(version ? adminEn.pageTitle.replace('{page}', name) : undefined)

  // An added version that finished processing became a published version (it is current now): go there.
  const published = !version && id ? allVersions.find((item) => item.fromDraftId === id) : undefined
  if (published) return <Navigate to={`${text.back.href}/${published.id}`} replace />
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
        {version.neverCurrent && version.processing && <ProcessingStatusBadge status={version.processing.status} />}
      </div>

      {/* An added version: processing by the compliance service, then Make Current (GVP phase 2) */}
      {version.neverCurrent && version.processing && (
        <GuidelineProcessingCard
          version={version}
          onRetry={() => retryProcessing(version.id)}
          onMakeCurrent={async () => {
            const newId = await makeCurrent(version.id)
            // The added version became a published one with a new id.
            if (newId) navigate(`${text.back.href}/${newId}`, { replace: true })
          }}
        />
      )}

      {/* A new view for each version, so the requirements start closed */}
      <GuidelineVersionView key={version.id} version={version} />
    </>
  )
}
