import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Clock, Download, FileText, Lock } from 'lucide-react'
import { DocxViewer } from '../components/sops/DocxViewer'
import { AccessPanel, PdfViewer } from '../components/sops/PdfViewer'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { StatusBadge } from '../components/ui/StatusBadge'
import { loadingEn } from '../content/loading.en'
import { sopsEn } from '../content/sops.en'
import type { Sop } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { currentVersionOf, useFileUrl } from '../hooks/useFileUrl'
import { sopDownloadName } from '../lib/sopPresentation'
import { formatDate } from '../lib/format'
import { ADMIN_SOPS_PATH, requestDepartmentAccessPath } from '../lib/routes'
import { getSopAccess } from '../lib/sopAccess'
import { divisionLabel } from '../lib/userAdmin'
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
 * Only published SOPs are in the directory; other ids show Not Found. In the admin portal
 * ("/admin/sops/:id", `admin`) it is the same page, back to the admin directory, without Request
 * Access: admins don't request department access.
 */
export function SopDetailPage({ admin = false }: { admin?: boolean }) {
  const content = sopsEn.detail
  const { id } = useParams()
  const { sops } = useSops()
  const sop = sops.find((item) => item.id === id && item.status === 'published')
  // An unknown id leaves the title to the embedded Not Found page.
  useDocumentTitle(sop ? (admin ? content.adminPageTitle : content.pageTitle).replace('{title}', sop.title) : undefined)

  const user = useCurrentUser()
  const requests = useMyRequests()
  const departments = useDepartments()
  const fileUrl = useFileUrl(sop && getSopAccess(sop, user, requests) === 'granted' ? sop : undefined)
  const [fileError, setFileError] = useState('')
  const [downloading, setDownloading] = useState(false)

  if (!sop) return <NotFoundPage embedded />

  const access = getSopAccess(sop, user, requests)
  const departmentName = departments.nameOf(sop.departmentId)
  // The department's division by name ('' without one: the subtitle then starts with the department).
  const divisionName = divisionLabel(departments.getDepartment(sop.departmentId))
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
    <Button {...(stored ? { onClick: download, disabled: downloading } : { href: fileUrl, download: downloadName(sop) })}>
      <Download aria-hidden="true" className="size-4" strokeWidth={2} />
      {content.exportPdf}
    </Button>
  )

  return (
    <>
      <Link
        to={admin ? ADMIN_SOPS_PATH : content.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {content.back.label}
      </Link>

      {/* Header */}
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="mt-1 text-2xl leading-tight tracking-tight sm:text-3xl">{sop.title}</h1>
          {/* "<division> · <department> · Published on <date>" (no division: from the department): the date is
              the one on the directory cards; screen readers hear a comma instead of each "·". */}
          <p className="mt-2 text-sm text-text-gray">
            {(divisionName ? content.subtitle : content.subtitleNoDivision).split(/(\{division\}|\{department\}|\{date\}| · )/).filter(Boolean).map((part, index) =>
              part === '{date}' ? <time key={index} dateTime={sop.lastUpdated}>{formatDate(sop.lastUpdated)}</time>
                : part === '{division}' ? <span key={index}>{divisionName}</span>
                  : part === '{department}' ? <span key={index}>{departmentName}</span>
                    : part === ' · ' ? <span key={index}><span aria-hidden="true"> · </span><span className="sr-only">, </span></span>
                      : <span key={index}>{part}</span>,
            )}
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
            text={(admin ? content.noAccess.adminText : content.noAccess.text).replace('{department}', departmentName)}
          >
            {!admin && <Button to={requestDepartmentAccessPath(sop.departmentId)}>{content.noAccess.requestAccess}</Button>}
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

        {/* A Word file: shown in the browser, with Download beside it */}
        {granted && fileUrl && sop.fileType === 'docx' && (
          <>
            <div className="mb-3 flex justify-end">
              <Button
                {...(stored ? { onClick: download, disabled: downloading } : { href: fileUrl, download: downloadName(sop) })}
                variant="secondary"
                size="sm"
              >
                <Download aria-hidden="true" className="size-4" strokeWidth={2} />
                {content.docx.download}
              </Button>
            </div>
            <DocxViewer
              url={fileUrl}
              fileKey={`${sop.id}\n${sop.version}\n${currentVersionOf(sop)?.storagePath ?? fileUrl}`}
              label={content.docx.viewerTitle.replace('{title}', sop.title)}
              text={{ loading: loadingEn.label, failed: content.fileFailed }}
            />
          </>
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
