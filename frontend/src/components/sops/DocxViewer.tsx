import { useEffect, useRef, useState } from 'react'
import { sanitizeDocxLinks } from '../../lib/docxLinks'

/** docx-preview's class prefix: all of its styles are scoped under it (see index.css for our overrides). */
const CLASS_NAME = 'hawkim-docx'

/** How docx-preview renders: the document's own layout, fitted to the width available (phones too). */
const OPTIONS = {
  className: CLASS_NAME,
  inWrapper: true,
  ignoreWidth: true,
  ignoreHeight: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  // Not shown: tracked changes, comments and embedded HTML (alt chunks).
  renderChanges: false,
  renderComments: false,
  renderAltChunks: false,
  // Images as data: URLs, so nothing is left behind as object URLs.
  useBase64URL: true,
}

interface DocxViewerProps {
  /** A link to the .docx file (a signed Storage link, or a sample file's URL). */
  url: string
  /** Which file this is: it is loaded again only when this changes, not when its signed link is renewed. */
  fileKey: string
  /** Accessible name of the preview region, e.g. "SOP-079 Data Integrity (Word document preview)". */
  label: string
  text: { loading: string; failed: string }
  /** The preview's height (default as the PDF viewer: 70% of the screen, at least 28rem). */
  heightClassName?: string
}

/**
 * A Word (.docx) file shown in the browser, like the PDF viewer (SOP page, version preview, review
 * page). docx-preview is loaded only when a Word file is shown. The file is fetched from its link and
 * rendered here, never sent anywhere else; unsafe links are removed before it is shown. The preview
 * is a labelled region that can be scrolled with the keyboard, and it adds no headings to the page.
 */
export function DocxViewer({ url, fileKey, label, text, heightClassName = 'h-[70vh] min-h-[28rem]' }: DocxViewerProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  // The newest link, read when loading starts (a renewed link alone doesn't load the file again).
  const urlRef = useRef(url)
  useEffect(() => {
    urlRef.current = url
  }, [url])
  const [loaded, setLoaded] = useState<{ key: string; ok: boolean } | null>(null)

  useEffect(() => {
    const body = bodyRef.current
    const styles = styleRef.current
    if (!body || !styles) return
    let active = true
    void (async () => {
      try {
        const [{ renderAsync }, response] = await Promise.all([import('docx-preview'), fetch(urlRef.current)])
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const file = await response.blob()
        // Rendered off the page first, so unsafe links are gone before anything is shown.
        const content = document.createElement('div')
        const contentStyles = document.createElement('div')
        await renderAsync(file, content, contentStyles, OPTIONS)
        sanitizeDocxLinks(content)
        if (!active) return
        styles.replaceChildren(...contentStyles.childNodes)
        body.replaceChildren(...content.childNodes)
        setLoaded({ key: fileKey, ok: true })
      } catch {
        if (active) setLoaded({ key: fileKey, ok: false })
      }
    })()
    return () => {
      active = false
      body.replaceChildren()
      styles.replaceChildren()
    }
  }, [fileKey])

  const status = loaded?.key !== fileKey ? 'loading' : loaded.ok ? 'ready' : 'failed'
  return (
    <div>
      {/* docx-preview's <style> elements (they apply while hidden) */}
      <div ref={styleRef} hidden />
      <div role="status">
        {status === 'loading' && <p className="px-1 py-2 text-sm text-text-gray">{text.loading}</p>}
      </div>
      {status === 'failed' && (
        <p role="alert" className="px-1 py-2 text-sm text-status-rejected-fg">
          {text.failed}
        </p>
      )}
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        hidden={status !== 'ready'}
        className={`docx-preview overflow-auto rounded-lg bg-beige ${heightClassName}`}
      >
        <div ref={bodyRef} />
      </div>
    </div>
  )
}
