import { useId, useRef, useState, type DragEvent, type Ref } from 'react'
import { CircleAlert, FileText, UploadCloud, X } from 'lucide-react'
import { formatFileSize } from '../../lib/format'

export interface FileDropzoneText {
  label: string
  /** e.g. "(optional)" */
  optionalTag?: string
  /** e.g. "PDF, DOC, DOCX or PNG, up to 10 MB each" */
  hint: string
  dropPrompt: string
  browse: string
  /** `{name}` is replaced with the file name. */
  remove: string
  /** `{name}` is replaced with the file name. */
  typeError: string
  /** `{name}` and `{max}` are replaced. */
  sizeError: string
}

interface FileDropzoneProps {
  files: File[]
  onChange: (files: File[]) => void
  /** Allowed extensions, lower case with the dot, e.g. [".pdf", ".png"]. */
  extensions: string[]
  maxSizeBytes: number
  text: FileDropzoneText
  /** Ref to the browse button (e.g. to move focus to it). */
  browseRef?: Ref<HTMLButtonElement>
  /** Allow several files (default). When false, a new file replaces the current one. */
  multiple?: boolean
  /** Validation error from the form (e.g. "Upload an SOP file."), shown under the zone. */
  error?: string
  className?: string
}

/**
 * File picker: a drag-and-drop zone plus a "browse" button (the keyboard path).
 * Checks type and size, lists accepted files with a remove button, and announces
 * rejected files. Files are only kept in memory; nothing is uploaded.
 * With `multiple={false}` it holds exactly one file (a new one replaces it).
 */
export function FileDropzone({
  files,
  onChange,
  extensions,
  maxSizeBytes,
  text,
  browseRef,
  multiple = true,
  error,
  className = '',
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [dragging, setDragging] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const labelId = useId()
  const hintId = useId()
  const errorId = useId()

  function addFiles(selected: FileList | null) {
    if (!selected) return
    const accepted: File[] = []
    const problems: string[] = []

    // In single-file mode only the first file of a selection or drop is used.
    const candidates = multiple ? Array.from(selected) : Array.from(selected).slice(0, 1)
    for (const file of candidates) {
      const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
      if (!extensions.includes(extension)) {
        problems.push(text.typeError.replace('{name}', file.name))
      } else if (file.size > maxSizeBytes) {
        problems.push(text.sizeError.replace('{name}', file.name).replace('{max}', formatFileSize(maxSizeBytes)))
      } else if (!multiple || !files.some((existing) => existing.name === file.name && existing.size === file.size)) {
        accepted.push(file) // skip exact duplicates silently
      }
    }

    setErrors(problems)
    if (accepted.length > 0) onChange(multiple ? [...files, ...accepted] : accepted)
  }

  function removeFile(index: number) {
    onChange(files.filter((_, i) => i !== index))
    setErrors([])
    // Keep focus in the list: on the next file's remove button, or the previous one.
    requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll('button')
      const target = buttons?.[Math.min(index, (buttons?.length ?? 1) - 1)]
      ;(target ?? inputRef.current?.parentElement?.querySelector<HTMLButtonElement>('button'))?.focus()
    })
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    addFiles(event.dataTransfer.files)
  }

  return (
    <div role="group" aria-labelledby={labelId} className={className}>
      <p id={labelId} className="mb-1.5 text-sm font-medium text-maroon">
        {text.label}
        {text.optionalTag && <span className="ml-1 font-normal text-text-gray">{text.optionalTag}</span>}
      </p>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors ${
          dragging ? 'border-maroon bg-maroon/[0.04]' : error ? 'border-maroon-secondary bg-white' : 'border-text-gray/40 bg-white'
        }`}
      >
        <UploadCloud aria-hidden="true" className="size-7 text-maroon" strokeWidth={1.5} />
        <p className="mt-2 text-sm text-text-gray">
          {text.dropPrompt}{' '}
          <button
            ref={browseRef}
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            className="rounded-sm font-semibold text-maroon underline decoration-maroon/40 underline-offset-2 hover:decoration-maroon"
          >
            {text.browse}
          </button>
        </p>
        <p id={hintId} className="mt-1 text-xs text-text-gray">
          {text.hint}
        </p>
        {/* Hidden native input; the browse button opens it. */}
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={extensions.join(',')}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(event) => {
            addFiles(event.target.files)
            event.target.value = '' // allow choosing the same file again after removing it
          }}
        />
      </div>

      {/* Form validation error (e.g. no file chosen) */}
      {error && (
        <p id={errorId} className="mt-2 flex items-start gap-1.5 text-sm text-maroon-secondary">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          {error}
        </p>
      )}

      {/* Rejected files (announced politely) */}
      <div aria-live="polite">
        {errors.length > 0 && (
          <ul className="mt-2 space-y-1">
            {errors.map((error) => (
              <li key={error} className="flex items-start gap-1.5 text-sm text-maroon-secondary">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
                {error}
              </li>
            ))}
          </ul>
        )}
      </div>

      {files.length > 0 && (
        <ul ref={listRef} className="mt-3 divide-y divide-beige rounded-lg border border-beige">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}`} className="flex items-center gap-3 px-3.5 py-2.5">
              <FileText aria-hidden="true" className="size-5 shrink-0 text-maroon" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-maroon">{file.name}</p>
                <p className="text-xs text-text-gray">{formatFileSize(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => removeFile(index)}
                aria-label={text.remove.replace('{name}', file.name)}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-text-gray hover:bg-beige hover:text-maroon"
              >
                <X aria-hidden="true" className="size-4" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
