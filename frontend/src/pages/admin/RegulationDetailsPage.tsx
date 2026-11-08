import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { GuidelineRequirements } from '../../components/admin/GuidelineRequirements'
import { GuidelineVersionDetails } from '../../components/admin/GuidelineVersionDetails'
import { PdfViewer } from '../../components/sops/PdfViewer'
import { adminEn } from '../../content/admin.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useGuidelineFileUrl } from '../../hooks/useGuidelineFileUrl'
import { newestVersion } from '../../lib/guidelines'
import { useGuidelines } from '../../state/guidelinesContext'
import { NotFoundPage } from '../NotFoundPage'

/** The id of the Requirements section, which the requirements count in the details shows and hides. */
const REQUIREMENTS_SECTION = 'guideline-requirements'

/**
 * A GVP version ("/admin/regulations/:id", PBI 20): its details; its requirements, shown from the
 * details' count; and its PDF in a card of its own, through a signed link, when it has one. The
 * newest version shows the Current badge, as on the SFDA Regulatory Requirements tab (display only).
 */
export function RegulationDetailsPage() {
  const { id } = useParams()
  const text = adminEn.regulationDetails
  const names = adminEn.regulations
  const { getVersion, current, allVersions } = useGuidelines()
  const version = getVersion(id)
  const shownCurrent = newestVersion(allVersions, current)
  const file = useGuidelineFileUrl(version)
  const name = version ? names.versionName.replace('{version}', version.version) : ''
  useDocumentTitle(version ? adminEn.pageTitle.replace('{page}', name) : undefined)
  const [showRequirements, setShowRequirements] = useState(false)

  if (!version) return <NotFoundPage embedded />
  const actions = {
    requirements: { expanded: showRequirements, controlsId: REQUIREMENTS_SECTION, onToggle: () => setShowRequirements((shown) => !shown) },
    withoutFile: true,
  }

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
        {version.id === shownCurrent.id && (
          <span className="rounded-full border border-maroon/20 bg-maroon/[0.06] px-2.5 py-0.5 text-xs font-medium text-maroon">
            {names.current.badge}
          </span>
        )}
      </div>

      <section aria-labelledby="details-title" className="mt-6 max-w-4xl rounded-xl border border-beige bg-white p-5 sm:p-6">
        <h2 id="details-title" className="text-lg">
          {text.details.title}
        </h2>
        <GuidelineVersionDetails version={version} actions={actions} className="mt-4" />
      </section>

      {/* Hidden, heading included, until the requirements count is pressed */}
      <GuidelineRequirements version={version} id={REQUIREMENTS_SECTION} titleId="requirements-title" heading="h2" hidden={!showRequirements} className="mt-8" />

      <section aria-labelledby="file-title" className="mt-8 rounded-xl border border-beige bg-white p-5 sm:p-6">
        <h2 id="file-title" className="text-lg">
          {text.file.title}
        </h2>
        {/* The PDF viewer has its own download; browsers without one get the fallback link */}
        <p className="mt-3 text-sm font-medium break-all text-maroon">{version.fileName}</p>
        {file.url ? (
          <div className="mt-4">
            <PdfViewer
              url={file.url}
              title={text.file.viewerTitle.replace('{fileName}', version.fileName)}
              fallback={text.file.fallback}
              heightClassName="h-[80vh] min-h-[28rem]"
            />
          </div>
        ) : file.state === 'failed' ? (
          <p role="alert" className="mt-1 text-sm text-status-rejected-fg">{text.file.openFailed}</p>
        ) : file.state === 'none' ? (
          <p className="mt-1 text-sm text-text-gray">{text.file.unavailable}</p>
        ) : null}
      </section>
    </>
  )
}
