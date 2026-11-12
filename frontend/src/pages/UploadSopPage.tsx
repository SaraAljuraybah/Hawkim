import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, LoaderCircle, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { FileDropzone } from '../components/ui/FileDropzone'
import { TextAreaField } from '../components/ui/TextAreaField'
import { TextField } from '../components/ui/TextField'
import { uploadSopEn } from '../content/mySops.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatDate } from '../lib/format'
import { hasPermission } from '../lib/permissions'
import { riyadhDate } from '../lib/riyadhWorkingDays'
import { SOP_DESCRIPTION_MAX } from '../lib/sopDescription'
import { SOP_TITLE_MAX, sopTitleProblem } from '../lib/sopTitle'
import { divisionLabel } from '../lib/userAdmin'
import { useActiveDepartment } from '../state/activeDepartmentContext'
import { useCurrentUser } from '../state/sessionContext'
import { useSops } from '../state/sopsContext'
import { NotFoundPage } from './NotFoundPage'
import type { MySopsLocationState } from './MySopsPage'

/** Authors can upload Word (.docx) and PDF files (PBI 1). */
const FILE_EXTENSIONS = ['.docx', '.pdf']
const FILE_MAX_BYTES = 10 * 1024 * 1024 // 10 MB

type Field = 'title' | 'file'
type FieldErrors = Partial<Record<Field, string>>

/** Add SOP ("/my-sops/upload", Author permission): saves a new draft in the home department. */
export function UploadSopPage() {
  const content = uploadSopEn
  const user = useCurrentUser()
  const isAuthor = hasPermission(user, 'author')
  useDocumentTitle(isAuthor ? content.pageTitle : undefined)

  const { homeDepartment } = useActiveDepartment()
  // Today in Riyadh, the day the SOP is added (the database records it as it saves the SOP).
  const today = riyadhDate(new Date())
  const { addDraft } = useSops()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState('')

  const titleRef = useRef<HTMLInputElement>(null)
  const browseRef = useRef<HTMLButtonElement>(null)

  if (!isAuthor) return <NotFoundPage embedded />

  function validate(field: Field, values = { title, files }): string | undefined {
    if (field === 'title') {
      const problem = sopTitleProblem(values.title)
      return problem === 'required' ? content.errors.titleRequired : problem === 'too-long' ? content.errors.titleTooLong : undefined
    }
    return values.files.length === 1 ? undefined : content.errors.fileRequired
  }

  // After the first submit attempt, the title re-validates on blur and the file when it changes.
  function handleFilesChange(next: File[]) {
    setFiles(next)
    if (submitAttempted) setErrors((prev) => ({ ...prev, file: validate('file', { title, files: next }) }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    setSubmitAttempted(true)
    const nextErrors: FieldErrors = { title: validate('title'), file: validate('file') }
    // Render the messages before moving focus, so screen readers read them with the field.
    flushSync(() => setErrors(nextErrors))
    if (nextErrors.title) {
      titleRef.current?.focus()
      return
    }
    if (nextErrors.file) {
      browseRef.current?.focus()
      return
    }

    setSaveError('')
    setSubmitting(true)
    try {
      await addDraft({
        title: title.trim(),
        description: description.trim() || undefined,
        departmentId: homeDepartment.id,
        file: files[0],
      })
    } catch {
      setSubmitting(false)
      setSaveError(content.errors.saveFailed)
      return
    }
    // Back to My SOPs, which announces the success message.
    const state: MySopsLocationState = { uploaded: true }
    navigate(content.cancel.href, { state })
  }

  return (
    <>
      <Link
        to={content.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {content.back.label}
      </Link>
      <h1 className="mt-5 text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{content.subtitle.replace('{department}', homeDepartment.name)}</p>

      <div className="mt-8 max-w-[45rem] rounded-xl border border-beige bg-white p-5 sm:p-8">
        <form noValidate onSubmit={handleSubmit} className="space-y-6">
          <TextField
            ref={titleRef}
            name="title"
            label={content.fields.title.label}
            placeholder={content.fields.title.placeholder}
            hint={content.fields.title.hint}
            required
            requiredMark
            maxLength={SOP_TITLE_MAX}
            counter={content.fields.title.counter.replace('{count}', String(title.length)).replace('{max}', String(SOP_TITLE_MAX))}
            value={title}
            error={errors.title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => submitAttempted && setErrors((prev) => ({ ...prev, title: validate('title') }))}
          />

          {/* Read-only, shown only: new SOPs are added to the home department (and so its division), and the
              database records the day it's added. None of these is sent with the form. */}
          <ReadOnlyValue label={content.fields.division.label}>{divisionLabel(homeDepartment) || content.fields.division.none}</ReadOnlyValue>
          <ReadOnlyValue label={content.fields.department.label}>{homeDepartment.name}</ReadOnlyValue>
          <ReadOnlyValue label={content.fields.addedOn.label}><time dateTime={today}>{formatDate(today)}</time></ReadOnlyValue>

          <FileDropzone
            files={files}
            onChange={handleFilesChange}
            extensions={FILE_EXTENSIONS}
            maxSizeBytes={FILE_MAX_BYTES}
            text={content.fields.file}
            browseRef={browseRef}
            multiple={false}
            error={errors.file}
          />

          <TextAreaField
            name="description"
            label={content.fields.description.label}
            placeholder={content.fields.description.placeholder}
            maxLength={SOP_DESCRIPTION_MAX}
            counter={content.fields.description.counter
              .replace('{count}', String(description.length))
              .replace('{max}', String(SOP_DESCRIPTION_MAX))}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          {saveError && (
            <p role="alert" className="text-sm text-status-rejected-fg">
              {saveError}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-beige pt-6 sm:flex-row sm:justify-end">
            <Button to={content.cancel.href} variant="secondary">
              {content.cancel.label}
            </Button>
            <Button type="submit" aria-disabled={submitting || undefined}>
              {submitting ? (
                <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />
              ) : (
                <Upload aria-hidden="true" className="size-4" strokeWidth={2} />
              )}
              {submitting ? content.submit.loadingLabel : content.submit.label}
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}

/** A pre-filled value the form shows but doesn't send. */
function ReadOnlyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-maroon">{label}</p>
      <p className="rounded-lg border border-beige bg-beige/50 px-3.5 py-2.5 text-[0.9375rem] text-maroon">{children}</p>
    </div>
  )
}
