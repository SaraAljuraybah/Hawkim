import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copyToClipboard } from './clipboard'
import { IconButton } from './IconButton'

export type CopyStatus = 'idle' | 'copied' | 'failed'

interface CopyButtonProps {
  /** The text put on the clipboard, e.g. an email address. */
  text: string
  /** Accessible name and tooltip, e.g. "Copy Sara Ahmed's email". */
  label: string
  /** Shown and announced after copying, e.g. "Copied". */
  copiedText: string
  /** Shown and announced when the browser can't copy. */
  failedText: string
}

/** How long the confirmation and the error stay visible (ms). */
const COPIED_MS = 2000
const FAILED_MS = 5000

/**
 * An icon-only button that copies `text`, then shows a short confirmation (or error) next
 * to it. The message is in a polite live region, so screen readers announce it too.
 */
export function CopyButton({ text, label, copiedText, failedText }: CopyButtonProps) {
  const [status, setStatus] = useState<CopyStatus>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    clearTimeout(timer.current)
    // Cleared first, so copying again announces the message again.
    setStatus('idle')
    const next: CopyStatus = (await copyToClipboard(text)) ? 'copied' : 'failed'
    setStatus(next)
    timer.current = setTimeout(() => setStatus('idle'), next === 'copied' ? COPIED_MS : FAILED_MS)
  }

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5">
      <IconButton bare label={label} icon={status === 'copied' ? Check : Copy} onClick={() => void copy()} />
      <span aria-live="polite" className={`text-xs font-medium ${status === 'failed' ? 'text-status-rejected-fg' : 'text-maroon'}`}>
        {status === 'copied' ? copiedText : status === 'failed' ? failedText : ''}
      </span>
    </span>
  )
}
