import { useState } from 'react'
import { GuidelineRequirements } from '../admin/GuidelineRequirements'
import { GuidelineVersionDetails } from '../admin/GuidelineVersionDetails'
import { PdfViewer } from '../sops/PdfViewer'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { useGuidelineFileUrl } from '../../hooks/useGuidelineFileUrl'

/** The id of the Requirements section, which the requirements count in the details shows and hides. */
const REQUIREMENTS_SECTION = 'guideline-requirements'

/**
 * A GVP version, read-only: its details; its requirements, shown from the details' count; and its PDF
 * in a card of its own, through a signed link, when it has one. Below the page's h1: the admin's
 * version page and the author's GVP page (from the Compliance Overview) both show it.
 */
export function GuidelineVersionView({ version }: { version: GuidelineVersion }) {
  const text = adminEn.regulationDetails
  const file = useGuidelineFileUrl(version)
  const [showRequirements, setShowRequirements] = useState(false)
  const actions = {
    requirements: { expanded: showRequirements, controlsId: REQUIREMENTS_SECTION, onToggle: () => setShowRequirements((shown) => !shown) },
    withoutFile: true,
  }

  return (
    <>
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
