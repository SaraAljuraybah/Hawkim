import type { ReactNode } from 'react'
import { ExternalLink, FileText } from 'lucide-react'
import { Button } from '../ui/Button'

/** Whether the browser can show PDFs inline (false on most phones). */
const canShowPdfInline = typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false

interface PdfViewerProps {
  url: string
  /** Accessible name of the embedded viewer, e.g. "SOP-078 Data Integrity Guidelines (PDF)". */
  title: string
  fallback: { text: string; openPdf: string; newTabHint: string }
}

/**
 * The PDF shown inline (SOP detail page, review page). Browsers without an inline
 * viewer get a button that opens it in a new tab instead.
 */
export function PdfViewer({ url, title, fallback }: PdfViewerProps) {
  return canShowPdfInline ? (
    <iframe src={url} title={title} className="block h-[70vh] min-h-[28rem] w-full rounded-lg border-0 bg-beige" />
  ) : (
    <AccessPanel icon={<FileText className="size-6" strokeWidth={1.75} />} title={fallback.text}>
      <Button href={url} target="_blank" rel="noopener noreferrer" variant="secondary">
        <ExternalLink aria-hidden="true" className="size-4" strokeWidth={2} />
        {fallback.openPdf}
        <span className="sr-only"> {fallback.newTabHint}</span>
      </Button>
    </AccessPanel>
  )
}

interface AccessPanelProps {
  icon: ReactNode
  title: string
  text?: string
  children?: ReactNode
}

/** Centred message used instead of the viewer (no access, pending, no preview). */
export function AccessPanel({ icon, title, text, children }: AccessPanelProps) {
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
