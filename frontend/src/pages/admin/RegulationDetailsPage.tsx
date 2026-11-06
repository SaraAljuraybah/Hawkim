import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { GuidelineVersionDetails } from '../../components/admin/GuidelineVersionDetails'
import { PdfViewer } from '../../components/sops/PdfViewer'
import { tableStyles } from '../../components/ui/tableStyles'
import { adminEn } from '../../content/admin.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useGuidelines } from '../../state/guidelinesContext'
import { NotFoundPage } from '../NotFoundPage'

/** The id of the Requirements section, which the requirements count in the details shows and hides. */
const REQUIREMENTS_SECTION = 'guideline-requirements'

/**
 * A GVP version ("/admin/regulations/:id", PBI 20): its details; its requirements, shown from the
 * details' count; and its file in a card of its own, embedded when this browser has it (versions
 * added here, until reload).
 */
export function RegulationDetailsPage() {
  const { id } = useParams()
  const text = adminEn.regulationDetails
  const names = adminEn.regulations
  const { getVersion, current } = useGuidelines()
  const version = getVersion(id)
  const name = version ? names.versionName.replace('{version}', version.version) : ''
  useDocumentTitle(version ? adminEn.pageTitle.replace('{page}', name) : undefined)
  const [showRequirements, setShowRequirements] = useState(false)

  if (!version) return <NotFoundPage embedded />
  const columns = text.requirements.columns
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
        {version.id === current.id && (
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
      <section id={REQUIREMENTS_SECTION} aria-labelledby="requirements-title" hidden={!showRequirements} className="mt-8">
        <h2 id="requirements-title" className="text-lg">
          {text.requirements.title}
        </h2>
        <div className={`mt-3 ${tableStyles.frame}`}>
          {/* Table — md and up, styled like the other admin tables (scrolls inside its frame if ever too wide) */}
          <div className={`${tableStyles.wide} overflow-x-auto`}>
            <table aria-label={text.requirements.tableLabel} className={tableStyles.table}>
              <thead className={tableStyles.head}>
                <tr>
                  <th scope="col" className={tableStyles.headCell}>{columns.id}</th>
                  <th scope="col" className={tableStyles.headCell}>{columns.module}</th>
                  <th scope="col" className={tableStyles.headCell}>{columns.section}</th>
                  <th scope="col" className={tableStyles.headCell}>{columns.title}</th>
                  <th scope="col" className={tableStyles.headCell}>{columns.page}</th>
                  <th scope="col" className={tableStyles.headCell}>{columns.summary}</th>
                </tr>
              </thead>
              <tbody className={`${tableStyles.body} align-top`}>
                {version.requirements.map((requirement) => (
                  <tr key={requirement.id}>
                    <th scope="row" className={tableStyles.rowHeader}>{requirement.id}</th>
                    <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>{requirement.module}</td>
                    <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>{requirement.section}</td>
                    <td className={`${tableStyles.cell} font-medium text-maroon`}>{requirement.sectionTitle}</td>
                    <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>
                      {text.requirements.page.replace('{page}', String(requirement.page))}
                    </td>
                    <td className={`${tableStyles.cell} text-text-gray`}>{requirement.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Stacked cards — below md */}
          <ul aria-label={text.requirements.tableLabel} className={tableStyles.cards}>
            {version.requirements.map((requirement) => (
              <li key={requirement.id} className="p-4">
                <p className="text-sm font-semibold text-maroon">
                  {requirement.id} · {requirement.sectionTitle}
                </p>
                <p className="mt-0.5 text-sm text-text-gray">
                  {requirement.module} · {requirement.section} ·{' '}
                  {text.requirements.page.replace('{page}', String(requirement.page))}
                </p>
                <p className="mt-1.5 text-sm text-maroon">{requirement.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="file-title" className="mt-8 rounded-xl border border-beige bg-white p-5 sm:p-6">
        <h2 id="file-title" className="text-lg">
          {text.file.title}
        </h2>
        {/* The PDF viewer has its own download; browsers without one get the fallback link */}
        <p className="mt-3 text-sm font-medium break-all text-maroon">{version.fileName}</p>
        {version.fileUrl ? (
          <div className="mt-4">
            <PdfViewer
              url={version.fileUrl}
              title={text.file.viewerTitle.replace('{fileName}', version.fileName)}
              fallback={text.file.fallback}
              heightClassName="h-[80vh] min-h-[28rem]"
            />
          </div>
        ) : (
          <p className="mt-1 text-sm text-text-gray">{text.file.unavailable}</p>
        )}
      </section>
    </>
  )
}
