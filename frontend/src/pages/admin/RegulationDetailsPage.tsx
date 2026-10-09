import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { GuidelineVersionDetails } from '../../components/admin/GuidelineVersionDetails'
import { adminEn } from '../../content/admin.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useGuidelines } from '../../state/guidelinesContext'
import { NotFoundPage } from '../NotFoundPage'

/**
 * A GVP version ("/admin/regulations/:id", PBI 20): its details and its requirements
 * (read-only; versions can't be edited or deleted).
 */
export function RegulationDetailsPage() {
  const { id } = useParams()
  const text = adminEn.regulationDetails
  const names = adminEn.regulations
  const { getVersion, current } = useGuidelines()
  const version = getVersion(id)
  const name = version ? names.versionName.replace('{version}', version.version) : ''
  useDocumentTitle(version ? adminEn.pageTitle.replace('{page}', name) : undefined)

  if (!version) return <NotFoundPage embedded />
  const columns = text.requirements.columns

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
        <GuidelineVersionDetails version={version} className="mt-4" />
      </section>

      <section aria-labelledby="requirements-title" className="mt-8">
        <h2 id="requirements-title" className="text-lg">
          {text.requirements.title}
        </h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-beige bg-white">
          {/* Table — lg and up (scrolls inside its own box if it is ever too wide) */}
          <div className="hidden overflow-x-auto lg:block">
            <table aria-label={text.requirements.tableLabel} className="w-full text-left text-sm">
              <thead className="bg-beige/60 text-maroon">
                <tr>
                  <th scope="col" className="px-5 py-3 font-semibold">{columns.id}</th>
                  <th scope="col" className="px-5 py-3 font-semibold">{columns.module}</th>
                  <th scope="col" className="px-5 py-3 font-semibold">{columns.section}</th>
                  <th scope="col" className="px-5 py-3 font-semibold">{columns.title}</th>
                  <th scope="col" className="px-5 py-3 font-semibold">{columns.page}</th>
                  <th scope="col" className="px-5 py-3 font-semibold">{columns.summary}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-beige align-top">
                {version.requirements.map((requirement) => (
                  <tr key={requirement.id}>
                    <th scope="row" className="px-5 py-3.5 font-semibold text-maroon">{requirement.id}</th>
                    <td className="px-5 py-3.5 whitespace-nowrap text-text-gray">{requirement.module}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-text-gray">{requirement.section}</td>
                    <td className="px-5 py-3.5 font-medium text-maroon">{requirement.sectionTitle}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-text-gray">
                      {text.requirements.page.replace('{page}', String(requirement.page))}
                    </td>
                    <td className="px-5 py-3.5 text-text-gray">{requirement.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Stacked cards — below lg */}
          <ul aria-label={text.requirements.tableLabel} className="divide-y divide-beige lg:hidden">
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
    </>
  )
}
