import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Clock, Download, FileText, Lock } from 'lucide-react'
import { AccessPanel, PdfViewer } from '../components/sops/PdfViewer'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { StatusBadge } from '../components/ui/StatusBadge'
import { sopsEn } from '../content/sops.en'
import type { Sop } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { currentVersionOf, useFileUrl } from '../hooks/useFileUrl'
import { sopDownloadName } from '../lib/sopPresentation'
import { formatDate } from '../lib/format'
import { requestDepartmentAccessPath } from '../lib/routes'
import { getSopAccess } from '../lib/sopAccess'
import { fileUrlOf } from '../services/files'
import { useDepartments } from '../state/departmentsContext'
import { useMyRequests } from '../state/requestsContext'
import { useCurrentUser } from '../state/sessionContext'
import { useSops } from '../state/sopsContext'
import { NotFoundPage } from './NotFoundPage'

/** A title-based download name; the stored SOP identifier and uploaded file stay intact. */
function downloadName(sop: Sop) {
  return sopDownloadName(sop.title, sop.version, sop.fileType)
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
  useDocumentTitle(sop ? content.pageTitle.replace('{title}', sop.title) : undefined)

  const user = useCurrentUser()
  const requests = useMyRequests()
  const departments = useDepartments()
  const fileUrl = useFileUrl(sop && getSopAccess(sop, user, requests) === 'granted' ? sop : undefined)
  const [fileError, setFileError] = useState('')
  const [downloading, setDownloading] = useState(false)

  if (!sop) return <NotFoundPage embedded />

  const access = getSopAccess(sop, user, requests)
  const departmentName = departments.nameOf(sop.departmentId)
  const granted = access === 'granted'

  async function download() {
    if (!sop || !granted || downloading) return
    setFileError('')
    setDownloading(true)
    try {
      const url = await fileUrlOf(currentVersionOf(sop) ?? sop, downloadName(sop))
      if (!url) throw new Error('Unavailable')
      window.location.assign(url)
    } catch { setFileError(content.fileFailed) }
    finally { setDownloading(false) }
  }
  const stored = !!currentVersionOf(sop)?.storagePath

  const exportButton = granted && sop.fileType === 'pdf' && fileUrl && (
    <Button href={stored ? undefined : fileUrl} download={stored ? undefined : downloadName(sop)}
      onClick={stored ? download : undefined} disabled={downloading}>
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

      {granted && sop.description?.trim() && (
        <Card title={content.descriptionTitle} titleId="description-title" className="mt-6">
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-maroon">{sop.description}</p>
        </Card>
      )}
      {fileError && <p role="alert" className="mt-4 text-sm text-status-rejected-fg">{fileError}</p>}

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
            <Button href={stored ? undefined : fileUrl} download={stored ? undefined : downloadName(sop)}
              onClick={stored ? download : undefined} disabled={downloading}>
              <Download aria-hidden="true" className="size-4" strokeWidth={2} />
              {content.docx.download}
            </Button>
          </AccessPanel>
        )}

        {/* Without an inline viewer, the PDF opens in a new tab (Export PDF stays in the header). */}
        {granted && fileUrl && sop.fileType === 'pdf' && (
          <PdfViewer
            url={fileUrl}
            title={content.viewerTitle.replace('{title}', sop.title)}
            fallback={content.fallback}
          />
        )}
      </div>
    </>
  )
}
