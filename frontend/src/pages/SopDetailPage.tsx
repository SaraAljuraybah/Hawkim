import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Clock, Download, FileText, Lock } from 'lucide-react'
import { AccessPanel, PdfViewer } from '../components/sops/PdfViewer'
import { Button } from '../components/ui/Button'
import { StatusBadge } from '../components/ui/StatusBadge'
import { sopsEn } from '../content/sops.en'
import type { Sop } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatDate } from '../lib/format'
import { requestDepartmentAccessPath } from '../lib/routes'
import { getSopAccess } from '../lib/sopAccess'
import { useDepartments } from '../state/departmentsContext'
import { useMyRequests } from '../state/requestsContext'
import { useCurrentUser } from '../state/sessionContext'
import { useSops } from '../state/sopsContext'
import { NotFoundPage } from './NotFoundPage'

/** Download name for the SOP file, e.g. "SOP-078_v1.2.pdf". */
function downloadName(sop: Sop) {
  return `${sop.code}_v${sop.version}.${sop.fileType}`
}

/**
 * SOP detail ("/sops/:id"): header, Export PDF and the document viewer (if the user has access).
 * Only published SOPs are in the directory; other ids show Not Found.
 */
export function SopDetailPage() {
  const content = sopsEn.detail
  const { id } = useParams()
  const { sops } = useSops()
  const sop = sops.find((item) => item.id === id && item.status === 'published')
  // An unknown id leaves the title to the embedded Not Found page.
  useDocumentTitle(sop ? content.pageTitle.replace('{code}', sop.code) : undefined)

  // TODO: Load the SOP from the backend API.
  const user = useCurrentUser()
  const requests = useMyRequests()
  const departments = useDepartments()

  if (!sop) return <NotFoundPage embedded />

  const access = getSopAccess(sop, user, requests)
  const departmentName = departments.nameOf(sop.departmentId)
  const granted = access === 'granted'

  // TODO: Every published SOP will have a file URL from the backend; until then a few may not.
  const fileUrl = sop.fileUrl
  const exportButton = granted && sop.fileType === 'pdf' && fileUrl && (
    <Button href={fileUrl} download={downloadName(sop)}>
      <Download aria-hidden="true" className="size-4" strokeWidth={2} />
      {content.exportPdf}
    </Button>
  )

  return (
    <>
      <Link
        to={content.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {content.back.label}
      </Link>

      {/* Header */}
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-maroon">{sop.code}</p>
          <h1 className="mt-1 text-2xl leading-tight tracking-tight sm:text-3xl">{sop.title}</h1>
          <p className="mt-2 text-sm text-text-gray">
            {departmentName}
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, </span>
            {sopsEn.versionTemplate.replace('{version}', sop.version)}
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, </span>
            <time dateTime={sop.lastUpdated}>{formatDate(sop.lastUpdated)}</time>
          </p>
        </div>
        {exportButton && <div className="shrink-0">{exportButton}</div>}
      </div>

      <div className="mt-6 rounded-xl border border-beige bg-white p-3 sm:p-4">
        {access === 'locked' && (
          <AccessPanel
            icon={<Lock className="size-6" strokeWidth={1.75} />}
            title={content.noAccess.title}
            text={content.noAccess.text.replace('{department}', departmentName)}
          >
            <Button to={requestDepartmentAccessPath(sop.departmentId)}>{content.noAccess.requestAccess}</Button>
          </AccessPanel>
        )}

        {access === 'requested' && (
          <AccessPanel
            icon={<Clock className="size-6" strokeWidth={1.75} />}
            title={content.pendingAccess.title}
            text={content.pendingAccess.text.replace('{department}', departmentName)}
          >
            <StatusBadge status="pending" />
          </AccessPanel>
        )}

        {granted && !fileUrl && (
          <AccessPanel icon={<FileText className="size-6" strokeWidth={1.75} />} title={content.noFile} />
        )}

        {granted && fileUrl && sop.fileType === 'docx' && (
          // TODO: Convert Word documents to PDF on the server so they can be previewed here.
          <AccessPanel icon={<FileText className="size-6" strokeWidth={1.75} />} title={content.docx.text}>
            <Button href={fileUrl} download={downloadName(sop)}>
              <Download aria-hidden="true" className="size-4" strokeWidth={2} />
              {content.docx.download}
            </Button>
          </AccessPanel>
        )}

        {/* Without an inline viewer, the PDF opens in a new tab (Export PDF stays in the header). */}
        {granted && fileUrl && sop.fileType === 'pdf' && (
          <PdfViewer
            url={fileUrl}
            title={content.viewerTitle.replace('{code}', sop.code).replace('{title}', sop.title)}
            fallback={content.fallback}
          />
        )}
      </div>
    </>
  )
}
