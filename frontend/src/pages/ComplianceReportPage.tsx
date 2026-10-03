import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { ComplianceBadge } from '../components/compliance/ComplianceBadge'
import { ComplianceSummary, SampleBanner } from '../components/compliance/ComplianceSummary'
import { SelectField } from '../components/ui/SelectField'
import { Tabs, type TabItem } from '../components/ui/Tabs'
import { tabIds } from '../components/ui/tabIds'
import { complianceEn } from '../content/compliance.en'
import { getRequirement } from '../data/mock/compliance'
import { currentUser } from '../data/mock/currentUser'
import type { ComplianceResult } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { currentCheck, latestCompletedChecksByVersion, RESULT_ORDER, sortFindings } from '../lib/compliance'
import { formatDateTime } from '../lib/format'
import { hasPermission } from '../lib/permissions'
import { mySopPath } from '../lib/routes'
import { isAuthorOrCoAuthor } from '../lib/workflow'
import { useSops } from '../state/sopsContext'
import { NotFoundPage } from './NotFoundPage'

const TAB_ID_PREFIX = 'findings'

type TabKey = 'all' | ComplianceResult

/**
 * Compliance report ("/my-sops/:id/compliance", PBI 4, 5): the saved report of a
 * version — summary counts, and every finding with its requirement, justification
 * and SOP reference, filterable by result. Reports of earlier versions stay
 * viewable. Only the SOP's author and co-authors can open it. Sample results for now.
 */
export function ComplianceReportPage() {
  const { id } = useParams()
  // A new SOP starts fresh (its current version and the All tab).
  return <ComplianceReport key={id} id={id} />
}

function ComplianceReport({ id }: { id: string | undefined }) {
  const content = complianceEn
  const text = content.report
  const { sops } = useSops()
  // TODO: Use the authenticated user once real authentication exists.
  const user = currentUser
  const sop = sops.find((item) => item.id === id)
  const allowed = !!sop && hasPermission(user, 'author') && isAuthorOrCoAuthor(sop, user.id)
  useDocumentTitle(allowed ? text.pageTitle.replace('{code}', sop.code) : undefined)

  // Defaults to the current version; earlier versions' reports can be chosen.
  const [selectedVersion, setSelectedVersion] = useState(sop?.version)
  const [tab, setTab] = useState<TabKey>('all')

  if (!allowed) return <NotFoundPage embedded />

  const reports = latestCompletedChecksByVersion(sop)
  // The current version is always offered, even before its report is ready.
  const versions = [sop.version, ...reports.map((check) => check.version).filter((version) => version !== sop.version)]
  const version = selectedVersion && versions.includes(selectedVersion) ? selectedVersion : sop.version
  const report = reports.find((check) => check.version === version)
  const latest = version === sop.version ? currentCheck(sop) : undefined
  const unavailable = !report
    ? (latest?.status === 'running' ? text.running : latest?.status === 'failed' ? text.failed : text.none).replace(
        '{version}',
        version,
      )
    : undefined

  const findings = report ? sortFindings(report.findings).filter((finding) => tab === 'all' || finding.result === tab) : []
  const tabItems: TabItem<TabKey>[] = (['all', ...RESULT_ORDER] as const).map((key) => ({ key, label: text.tabs[key] }))
  const ids = tabIds(TAB_ID_PREFIX, tab)

  return (
    <>
      <Link
        to={mySopPath(sop.id)}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {text.back.replace('{code}', sop.code)}
      </Link>

      {/* Header */}
      <div className="mt-5">
        <p className="text-sm font-semibold text-maroon">
          {sop.code} <span aria-hidden="true">·</span>
          <span className="sr-only">,</span> {sop.title}
        </p>
        <h1 className="mt-1 text-2xl leading-tight tracking-tight sm:text-3xl">{text.title}</h1>
      </div>

      {versions.length > 1 && (
        <SelectField
          name="reportVersion"
          label={text.versionSelect.label}
          className="mt-6 max-w-xs"
          options={versions.map((option) => ({
            value: option,
            label: (option === sop.version ? text.versionSelect.current : text.versionSelect.option).replace('{version}', option),
          }))}
          value={version}
          onChange={(event) => setSelectedVersion(event.target.value)}
        />
      )}

      {report && (
        <dl className="mt-6 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[auto_auto_1fr]">
          <div>
            <dt className="text-text-gray">{content.details.version}</dt>
            <dd className="mt-0.5 font-medium text-maroon">{report.version}</dd>
          </div>
          <div>
            <dt className="text-text-gray">{content.details.checked}</dt>
            <dd className="mt-0.5 font-medium text-maroon">
              <time dateTime={report.completedAt}>{report.completedAt && formatDateTime(report.completedAt)}</time>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-text-gray">{content.details.guideline}</dt>
            <dd className="mt-0.5 font-medium text-maroon">
              {content.guideline.replace('{name}', report.guideline.name).replace('{version}', report.guideline.version)}
            </dd>
          </div>
        </dl>
      )}

      <SampleBanner text={content.sampleBanner} className="mt-6" />

      {unavailable && (
        <p role="status" className="mt-6 rounded-xl border border-beige bg-white p-5 text-sm text-text-gray sm:p-6">
          {unavailable}
        </p>
      )}

      {report && (
        <>
          <section aria-labelledby="summary-title" className="mt-6 rounded-xl border border-beige bg-white p-5 sm:p-6">
            <h2 id="summary-title" className="mb-4 text-lg">
              {text.summaryTitle}
            </h2>
            <ComplianceSummary check={report} content={content} />
          </section>

          <section aria-labelledby="findings-title" className="mt-8">
            <h2 id="findings-title" className="text-lg">
              {text.findingsTitle}
            </h2>
            <div className="mt-3 border-b border-beige">
              <Tabs
                items={tabItems}
                selected={tab}
                onSelect={setTab}
                label={text.tabsLabel}
                idPrefix={TAB_ID_PREFIX}
                className="flex-wrap gap-y-1"
              />
            </div>

            <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} tabIndex={0} className="mt-6 rounded-xl">
              {findings.length === 0 ? (
                <p className="rounded-xl border border-dashed border-beige bg-white px-6 py-10 text-center text-text-gray">
                  {text.empty}
                </p>
              ) : (
                <ul className="space-y-4">
                  {findings.map((finding) => {
                    const requirement = getRequirement(finding.requirementId)
                    return (
                      <li key={finding.id} className="rounded-xl border border-beige bg-white p-5 sm:p-6">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <ComplianceBadge result={finding.result} labels={content.results} />
                          {requirement && (
                            <h3 className="text-sm font-semibold text-maroon">
                              {text.requirementReference
                                .replace('{module}', requirement.module)
                                .replace('{section}', requirement.section)
                                .replace('{title}', requirement.sectionTitle)
                                .replace('{page}', String(requirement.page))}
                            </h3>
                          )}
                        </div>
                        {requirement && <p className="mt-3 text-[0.9375rem] text-maroon">{requirement.summary}</p>}
                        <div className="mt-3 rounded-lg bg-beige/60 px-4 py-3">
                          <p className="text-sm font-medium text-maroon">{text.justification}</p>
                          <p className="mt-1 text-sm text-maroon">{finding.justification}</p>
                        </div>
                        {finding.sopReference && (
                          <p className="mt-3 text-sm text-text-gray">
                            {text.sopReference.replace('{reference}', finding.sopReference)}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </>
  )
}
