import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SopWorkflowContent } from '../../content/types'
import { FileDropzone } from '../ui/FileDropzone'
import { FormDialog } from '../ui/FormDialog'

/** Same rules as Upload SOP: one .docx or PDF file, up to 10 MB. */
const FILE_EXTENSIONS = ['.docx', '.pdf']
const FILE_MAX_BYTES = 10 * 1024 * 1024

interface FileDialogProps {
  content: SopWorkflowContent['dialogs']
  title: string
  description: string
  confirmLabel: string
  onSubmit: (file: File) => void
  onClose: () => void
}

/** "Replace file" / "Upload new version": a dialog with the single-file picker. */
export function FileDialog({ content, title, description, confirmLabel, onSubmit, onClose }: FileDialogProps) {
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string>()
  const browseRef = useRef<HTMLButtonElement>(null)

  function confirm() {
    if (files.length !== 1) {
      flushSync(() => setError(content.fileRequired))
      browseRef.current?.focus()
      return false
    }
    onSubmit(files[0])
  }

  return (
    <FormDialog
      open
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={content.cancel}
      onConfirm={confirm}
      onClose={onClose}
    >
      <FileDropzone
        files={files}
        onChange={(next) => {
          setFiles(next)
          if (next.length === 1) setError(undefined)
        }}
        extensions={FILE_EXTENSIONS}
        maxSizeBytes={FILE_MAX_BYTES}
        text={content.fileField}
        browseRef={browseRef}
        multiple={false}
        error={error}
      />
    </FormDialog>
  )
}
