import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Clock, Download, ExternalLink, FileText, Lock } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { StatusBadge } from '../components/ui/StatusBadge'
import { sopsEn } from '../content/sops.en'
import { currentUser } from '../data/mock/currentUser'
import { getDepartmentName } from '../data/mock/departments'
import { sops } from '../data/mock/sops'
import type { Sop } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatDate } from '../lib/format'
import { requestDepartmentAccessPath } from '../lib/routes'
import { getSopAccess } from '../lib/sopAccess'
import { useRequests } from '../state/requestsContext'
import { NotFoundPage } from './NotFoundPage'

/** Download name for the SOP file, e.g. "SOP-078_v1.2.pdf". */
function downloadName(sop: Sop) {
  return `${sop.code}_v${sop.version}.${sop.fileType}`
}

/** Whether the browser can show PDFs inline (false on most phones). */
const canShowPdfInline = typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false

/** SOP detail ("/sops/:id"): header, Export PDF and the document viewer (if the user has access). */
export function SopDetailPage() {
  const content = sopsEn.detail
  const { id } = useParams()
  const sop = sops.find((item) => item.id === id)
  // An unknown id leaves the title to the embedded Not Found page.
  useDocumentTitle(sop ? content.pageTitle.replace('{code}', sop.code) : undefined)

  // TODO: Use the authenticated user and load the SOP from the backend API.
  const user = currentUser
  const { requests } = useRequests()

  if (!sop) return <NotFoundPage embedded />

  const access = getSopAccess(sop, user, requests)
  const departmentName = getDepartmentName(sop.departmentId)
  const granted = access === 'granted'

  const exportButton = granted && sop.fileType === 'pdf' && (
    <Button href={sop.fileUrl} download={downloadName(sop)}>
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

        {granted && sop.fileType === 'docx' && (
          // TODO: Convert Word documents to PDF on the server so they can be previewed here.
          <AccessPanel icon={<FileText className="size-6" strokeWidth={1.75} />} title={content.docx.text}>
            <Button href={sop.fileUrl} download={downloadName(sop)}>
              <Download aria-hidden="true" className="size-4" strokeWidth={2} />
              {content.docx.download}
            </Button>
          </AccessPanel>
        )}

        {granted && sop.fileType === 'pdf' &&
          (canShowPdfInline ? (
            <iframe
              src={sop.fileUrl}
              title={content.viewerTitle.replace('{code}', sop.code).replace('{title}', sop.title)}
              className="block h-[70vh] min-h-[28rem] w-full rounded-lg border-0 bg-beige"
            />
          ) : (
            // No inline viewer: offer to open the PDF in a new tab (Export PDF stays in the header).
            <AccessPanel icon={<FileText className="size-6" strokeWidth={1.75} />} title={content.fallback.text}>
              <Button href={sop.fileUrl} target="_blank" rel="noopener noreferrer" variant="secondary">
                <ExternalLink aria-hidden="true" className="size-4" strokeWidth={2} />
                {content.fallback.openPdf}
                <span className="sr-only"> {content.fallback.newTabHint}</span>
              </Button>
            </AccessPanel>
          ))}
      </div>
    </>
  )
}

interface AccessPanelProps {
  icon: ReactNode
  title: string
  text?: string
  children?: ReactNode
}

/** Centred message used instead of the viewer (no access, pending, no preview). */
function AccessPanel({ icon, title, text, children }: AccessPanelProps) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center sm:py-16">
      <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-full bg-beige text-maroon">
        {icon}
      </span>
      <h2 className="mt-4 text-lg text-balance">{title}</h2>
      {text && <p className="mt-2 max-w-md text-balance text-text-gray">{text}</p>}
      {children && <div className="mt-6">{children}</div>}
    </div>
  )
}
