import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, RefreshCw } from 'lucide-react'
import { SampleBanner } from '../components/compliance/ComplianceSummary'
import { ReportRequirementsContext } from '../components/compliance/reportRequirements'
import {
  ChangesList,
  ExecutiveSummary,
  FindingGroup,
  ReportSection,
  RequirementsOverview,
} from '../components/compliance/ReportSections'
import { Button } from '../components/ui/Button'
import { SelectField } from '../components/ui/SelectField'
import { Tabs, type TabItem } from '../components/ui/Tabs'
import { tabIds } from '../components/ui/tabIds'
import { complianceEn } from '../content/compliance.en'
import type { ComplianceResult, Sop } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
  compareReports,
  currentCheck,
  latestCompletedChecksByVersion,
  numberedFindings,
  previousReport,
  reportId,
  RESULT_ORDER,
} from '../lib/compliance'
import { formatDateTime } from '../lib/format'
import { hasPermission } from '../lib/permissions'
import { mySopPath, reviewPath } from '../lib/routes'
import { isApprover, isAuthorOrCoAuthor, isReviewer } from '../lib/workflow'
import { useDepartments } from '../state/departmentsContext'
import { useGuidelines } from '../state/guidelinesContext'
import { useCurrentUser } from '../state/sessionContext'
import { useSops } from '../state/sopsContext'
import { useUsers } from '../state/usersContext'
import { NotFoundPage } from './NotFoundPage'

const TAB_ID_PREFIX = 'findings'

type TabKey = 'all' | ComplianceResult

/**
 * Compliance report ("/my-sops/:id/compliance", PBI 4, 5), laid out as a formal
 * report: report details, executive summary, requirements overview, findings
 * (with recommended actions), changes since the previous version, and the method
 * and its limitations. Reports of earlier versions stay viewable, and "Download
 * PDF" prints it with a print stylesheet. Sample results for now.
 * - author:   "/my-sops/:id/compliance", for the SOP's author and co-authors;
 * - reviewer: "/reviews/:id/compliance", read-only, for its reviewers and approvers.
 */
export function ComplianceReportPage({ audience = 'author' }: { audience?: 'author' | 'reviewer' }) {
  const { id } = useParams()
  // A new SOP starts fresh (its current version and the All filter).
  return <ComplianceReport key={id} id={id} audience={audience} />
}

function ComplianceReport({ id, audience }: { id: string | undefined; audience: 'author' | 'reviewer' }) {
  const text = complianceEn.report
  const { sops } = useSops()
  const user = useCurrentUser()
  const sop = sops.find((item) => item.id === id)
  const allowed =
    !!sop &&
    (audience === 'author'
      ? hasPermission(user, 'author') && isAuthorOrCoAuthor(sop, user.id)
      : isReviewer(sop, user.id) || isApprover(sop, user.id))
  useDocumentTitle(allowed ? text.pageTitle.replace('{code}', sop.code) : undefined)

  if (!allowed) return <NotFoundPage embedded />
  return <Report sop={sop} backPath={audience === 'author' ? mySopPath(sop.id) : reviewPath(sop.id)} />
}

function Report({ sop, backPath }: { sop: Sop; backPath: string }) {
  const content = complianceEn
  const text = content.report
  const { nameOf } = useUsers()
  const { getRequirement, current: currentGuideline } = useGuidelines()
  const { nameOf: departmentName } = useDepartments()

  // Defaults to the current version; earlier versions' reports can be chosen.
  const [selectedVersion, setSelectedVersion] = useState(sop.version)
  const [tab, setTab] = useState<TabKey>('all')

  const reports = latestCompletedChecksByVersion(sop)
  // The current version is always offered, even before its report is ready.
  const versions = [sop.version, ...reports.map((check) => check.version).filter((version) => version !== sop.version)]
  const version = versions.includes(selectedVersion) ? selectedVersion : sop.version
  const report = reports.find((check) => check.version === version)
  const latest = version === sop.version ? currentCheck(sop) : undefined
  const unavailable = !report
    ? (latest?.status === 'running' ? text.running : latest?.status === 'failed' ? text.failed : text.none).replace(
        '{version}',
        version,
      )
    : undefined

  /*
   * Printing (Download PDF or Ctrl+P): every finding is shown (the filter is set to
   * All) and the document title becomes the PDF's default name; both are restored after.
   */
  const printTitle = text.printTitle.replace('{code}', sop.code).replace('{version}', version)
  const tabRef = useRef<TabKey>(tab)
  useEffect(() => {
    tabRef.current = tab
  }, [tab])
  useEffect(() => {
    let savedTitle = ''
    let savedTab: TabKey = 'all'
    const before = () => {
      savedTitle = document.title
      savedTab = tabRef.current
      document.title = printTitle
      flushSync(() => setTab('all'))
    }
    const after = () => {
      document.title = savedTitle
      setTab(savedTab)
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [printTitle])

  const numbered = report ? numberedFindings(report) : []
  const needsAttention = numbered.filter((finding) => finding.result !== 'compliant')
  const compliant = numbered.filter((finding) => finding.result === 'compliant')
  const previous = report ? previousReport(sop, report) : undefined

  /** Overview links: show the finding (switching to All if the filter hides it) and move focus to it. */
  function jumpTo(event: MouseEvent<HTMLAnchorElement>, number: string) {
    event.preventDefault()
    const finding = numbered.find((item) => item.number === number)
    if (finding && tab !== 'all' && finding.result !== tab) flushSync(() => setTab('all'))
    const target = document.getElementById(`finding-${number}`)
    if (!target) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
    target.focus({ preventScroll: true })
  }

  const tabItems: TabItem<TabKey>[] = (['all', ...RESULT_ORDER] as const).map((key) => ({ key, label: text.findings.tabs[key] }))
  const ids = tabIds(TAB_ID_PREFIX, tab)
  const author = nameOf(sop.authorId)
  const coAuthors = sop.coAuthorIds.map((coAuthorId) => nameOf(coAuthorId)).join(', ')

  const details = report
    ? [
        { label: text.header.reportId, value: reportId(sop, report) },
        { label: text.header.sop, value: `${sop.code} · ${sop.title}` },
        { label: text.header.version, value: content.versionLabel.replace('{version}', report.version) },
        { label: text.header.author, value: author },
        ...(coAuthors ? [{ label: text.header.coAuthors, value: coAuthors }] : []),
        { label: text.header.department, value: departmentName(sop.departmentId) },
        {
          label: text.header.checked,
          value: report.completedAt && <time dateTime={report.completedAt}>{formatDateTime(report.completedAt)}</time>,
        },
        {
          label: text.header.guideline,
          value: content.guideline.replace('{name}', report.guideline.name).replace('{version}', report.guideline.version),
        },
        { label: text.header.checkedBy, value: text.header.checker },
      ]
    : []

  return (
    <div className="print-report">
      <Link
        to={backPath}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon print:hidden"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {text.back.replace('{code}', sop.code)}
      </Link>

      {/* Title and export */}
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between print:mt-0">
        <h1 className="text-2xl leading-tight tracking-tight sm:text-3xl">{text.title}</h1>
        {report && (
          <Button variant="secondary" className="shrink-0 self-start sm:self-auto print:hidden" onClick={() => window.print()}>
            <Download aria-hidden="true" className="size-4" strokeWidth={2} />
            {text.download}
          </Button>
        )}
      </div>

      {versions.length > 1 && (
        <SelectField
          name="reportVersion"
          label={text.versionSelect.label}
          className="mt-6 max-w-xs print:hidden"
          options={versions.map((option) => ({
            value: option,
            label: (option === sop.version ? text.versionSelect.current : text.versionSelect.option).replace('{version}', option),
          }))}
          value={version}
          onChange={(event) => setSelectedVersion(event.target.value)}
        />
      )}

      {/* Checked against an older GVP version (also printed) */}
      {report && report.guideline.version !== currentGuideline.version && (
        <p className="mt-6 flex items-start gap-2 rounded-lg border border-status-pending-fg/25 bg-status-pending-bg px-3.5 py-2.5 text-sm font-medium text-status-pending-fg print:mt-2">
          <RefreshCw aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          {text.olderGuideline
            .replace('{checked}', report.guideline.version)
            .replace('{current}', currentGuideline.version)}
        </p>
      )}

      {/* a) Report header */}
      {report && (
        <section aria-labelledby="report-details-title" className="mt-6 rounded-xl border border-beige bg-white p-5 sm:p-6 print:mt-4 print:p-4">
          <h2 id="report-details-title" className="sr-only">
            {text.header.title}
          </h2>
          <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
            {details.map((detail) => (
              <div key={detail.label} className="min-w-0">
                <dt className="text-text-gray">{detail.label}</dt>
                <dd className="mt-0.5 font-medium break-words text-maroon">{detail.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <SampleBanner text={content.sampleBanner} className="mt-4" />

      {report && latest?.status === 'running' && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-status-pending-fg/25 bg-status-pending-bg px-3.5 py-2.5 text-sm text-status-pending-fg print:hidden"
        >
          {text.outOfDate.replace('{version}', version)}
        </p>
      )}

      {unavailable && (
        <p role="status" className="mt-6 rounded-xl border border-beige bg-white p-5 text-sm text-text-gray sm:p-6">
          {unavailable}
        </p>
      )}

      {report && (
        // Requirements as in the GVP version this report was checked against.
        <ReportRequirementsContext value={(requirementId) => getRequirement(report.guideline.version, requirementId)}>
          {/* b) Executive summary */}
          <ReportSection id="summary-title" title={text.summary.title}>
            <ExecutiveSummary
              check={report}
              previous={previous}
              status={sop.status}
              findings={numbered}
              content={content}
              onJump={jumpTo}
            />
          </ReportSection>

          {/* c) Requirements overview */}
          <ReportSection id="overview-title" title={text.overview.title}>
            <RequirementsOverview findings={numbered} content={content} onJump={jumpTo} />
          </ReportSection>

          {/* d) Findings */}
          <section aria-labelledby="findings-title" className="mt-8 print:mt-6">
            <h2 id="findings-title" className="text-lg">
              {text.findings.title}
            </h2>
            <div className="mt-3 border-b border-beige print:hidden">
              <Tabs
                items={tabItems}
                selected={tab}
                onSelect={setTab}
                label={text.findings.tabsLabel}
                idPrefix={TAB_ID_PREFIX}
                className="flex-wrap gap-y-1"
              />
            </div>
            <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} tabIndex={0} className="mt-6 rounded-xl print:mt-4">
              {tab === 'all' ? (
                <>
                  <FindingGroup id="needs-attention-title" title={text.findings.needsAttention} findings={needsAttention} content={content} />
                  <FindingGroup id="compliant-title" title={text.findings.compliant} findings={compliant} content={content} />
                </>
              ) : (
                <FindingGroup
                  id={`${tab}-title`}
                  title={text.findings.tabs[tab]}
                  findings={numbered.filter((finding) => finding.result === tab)}
                  content={content}
                />
              )}
            </div>
          </section>

          {/* e) Changes since the previous version */}
          <ReportSection id="changes-title" title={text.changes.title}>
            {previous ? (
              <ChangesList
                changes={compareReports(previous, report)}
                previousLabel={text.changes.comparedWith
                  .replace('{version}', previous.version)
                  .replace('{reportId}', reportId(sop, previous))}
                content={content}
              />
            ) : (
              <p className="text-sm text-text-gray">{text.changes.none}</p>
            )}
          </ReportSection>

          {/* f) Method and limitations */}
          <ReportSection id="method-title" title={text.method.title}>
            <ul className="max-w-[75ch] list-disc space-y-1.5 pl-5 text-sm text-maroon">
              {text.method.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </ReportSection>
        </ReportRequirementsContext>
      )}
    </div>
  )
}
