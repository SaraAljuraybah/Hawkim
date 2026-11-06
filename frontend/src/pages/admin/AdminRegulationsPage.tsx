import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight, CircleCheck, Plus } from 'lucide-react'
import { GuidelineVersionDetails } from '../../components/admin/GuidelineVersionDetails'
import { useGuidelineVersionValues } from '../../components/admin/guidelineVersionValues'
import { Button } from '../../components/ui/Button'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { adminRegulationPath } from '../../lib/routes'
import { useGuidelines } from '../../state/guidelinesContext'

/** Set after adding a version, to say so here. */
export interface AdminRegulationsLocationState {
  added?: string
}

/**
 * SFDA Regulatory Requirements ("/admin/regulations", PBI 20): the current GVP version, the earlier
 * versions as a read-only history table (newest first; stacked cards on narrow screens), and
 * "Add new version".
 */
export function AdminRegulationsPage() {
  const text = adminEn.regulations
  useDocumentTitle(adminEn.pageTitle.replace('{page}', text.title))
  const added = (useLocation().state as AdminRegulationsLocationState | null)?.added
  const { versions, current } = useGuidelines()
  const history = versions.filter((version) => version.id !== current.id).reverse()
  const values = useGuidelineVersionValues()

  const name = (version: GuidelineVersion) => text.versionName.replace('{version}', version.version)
  const viewLink = (version: GuidelineVersion): ReactNode => (
    <Link
      to={adminRegulationPath(version.id)}
      aria-label={text.viewRequirementsLabel.replace('{version}', version.version)}
      className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-maroon underline underline-offset-2 hover:text-maroon-secondary"
    >
      {text.viewRequirements}
      <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.75} />
    </Link>
  )

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight sm:text-3xl">{text.title}</h1>
          <p className="mt-2 text-text-gray">{text.subtitle}</p>
        </div>
        <Button to={text.addVersion.href} className="shrink-0 self-start sm:self-auto">
          <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
          {text.addVersion.label}
        </Button>
      </div>

      <div role="status">
        {added && (
          <p className="mt-6 flex items-center gap-2 rounded-lg border border-status-approved-fg/25 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {text.added.replace('{version}', added)}
          </p>
        )}
      </div>

      <div className="mt-8 grid max-w-4xl gap-8">
        <section aria-labelledby="current-title" className="rounded-xl border border-beige bg-white p-5 sm:p-6">
          <h2 id="current-title" className="text-sm font-semibold tracking-wide text-text-gray uppercase">
            {text.current.title}
          </h2>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-xl font-semibold text-maroon">
            {name(current)}
            <span className="rounded-full border border-maroon/20 bg-maroon/[0.06] px-2.5 py-0.5 text-xs font-medium">
              {text.current.badge}
            </span>
          </p>
          <GuidelineVersionDetails version={current} className="mt-5" />
          <div className="mt-5">{viewLink(current)}</div>
        </section>

        <section aria-labelledby="history-title">
          <h2 id="history-title" className="text-lg">
            {text.history.title}
          </h2>
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-text-gray">{text.history.empty}</p>
          ) : (
            <div className="mt-3 rounded-xl border border-beige bg-white">
              {/* Table — lg and up */}
              <div className="hidden lg:block">
                <table aria-label={text.history.tableLabel} className="w-full text-left text-sm">
                  <thead className="text-offwhite [&_th]:bg-maroon">
                    <tr>
                      {values(history[0]).map((item, index) => (
                        <th key={item.label} scope="col" className={`px-4 py-3 align-bottom font-semibold ${index === 0 ? 'rounded-tl-xl' : ''}`}>
                          {item.label}
                        </th>
                      ))}
                      <th scope="col" className="rounded-tr-xl px-4 py-3">
                        <span className="sr-only">{text.history.actions}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-beige">
                    {history.map((version) => (
                      <tr key={version.id}>
                        {values(version).map((item, index) =>
                          index === 0 ? (
                            <th key={item.label} scope="row" className="px-4 py-3 align-top font-medium text-maroon">{item.value}</th>
                          ) : (
                            <td key={item.label} className="px-4 py-3 align-top text-maroon">{item.value}</td>
                          ),
                        )}
                        <td className="px-4 py-3 align-top whitespace-nowrap">{viewLink(version)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Stacked cards — below lg */}
              <ul aria-label={text.history.tableLabel} className="divide-y divide-beige lg:hidden">
                {history.map((version) => (
                  <li key={version.id} className="p-5">
                    <h3 className="text-base font-semibold text-maroon">{name(version)}</h3>
                    <GuidelineVersionDetails version={version} className="mt-4" />
                    <div className="mt-4">{viewLink(version)}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
