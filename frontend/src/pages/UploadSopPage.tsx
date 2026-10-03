import { useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { LoaderCircle, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { CheckboxGroup } from '../components/ui/CheckboxGroup'
import { FileDropzone } from '../components/ui/FileDropzone'
import { TextAreaField } from '../components/ui/TextAreaField'
import { TextField } from '../components/ui/TextField'
import { uploadSopEn } from '../content/mySops.en'
import { currentUser } from '../data/mock/currentUser'
import { getDepartmentName } from '../data/mock/departments'
import { users } from '../data/mock/users'
import type { SopFileType } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { hasPermission } from '../lib/permissions'
import { useActiveDepartment } from '../state/activeDepartmentContext'
import { useSops } from '../state/sopsContext'
import { NotFoundPage } from './NotFoundPage'
import type { MySopsLocationState } from './MySopsPage'

const TITLE_MAX = 150
const DESCRIPTION_MAX = 1000
/** Authors can upload Word (.docx) and PDF files (PBI 1). */
const FILE_EXTENSIONS = ['.docx', '.pdf']
const FILE_MAX_BYTES = 10 * 1024 * 1024 // 10 MB
/** Simulated delay so the loading state can be seen (no backend yet). */
const UPLOAD_DELAY_MS = 600

type Field = 'title' | 'file'
type FieldErrors = Partial<Record<Field, string>>

function fileTypeOf(file: File): SopFileType {
  return file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx'
}

/** Upload SOP ("/my-sops/upload", Author permission): saves a new draft in the active department. */
export function UploadSopPage() {
  const content = uploadSopEn
  // TODO: Use the authenticated user once real authentication exists.
  const user = currentUser
  const isAuthor = hasPermission(user, 'author')
  useDocumentTitle(isAuthor ? content.pageTitle : undefined)

  const { activeDepartment } = useActiveDepartment()
  const { addDraft } = useSops()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [coAuthorIds, setCoAuthorIds] = useState<string[]>([])
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const titleRef = useRef<HTMLInputElement>(null)
  const browseRef = useRef<HTMLButtonElement>(null)

  if (!isAuthor) return <NotFoundPage embedded />

  // Co-authors: other users with the Author permission.
  const coAuthorOptions = users
    .filter((u) => u.id !== user.id && hasPermission(u, 'author'))
    .map((u) => ({ value: u.id, label: u.name, description: getDepartmentName(u.departmentId) }))

  function validate(field: Field, values = { title, files }): string | undefined {
    if (field === 'title') return values.title.trim() ? undefined : content.errors.titleRequired
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

    setSubmitting(true)
    // TODO: Upload the file to the backend. For now only its name and type are saved,
    // plus an in-memory URL so it can be downloaded during this session.
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_DELAY_MS))
    const file = files[0]
    addDraft({
      title: title.trim(),
      description: description.trim() || undefined,
      departmentId: activeDepartment.id,
      coAuthorIds,
      fileName: file.name,
      fileType: fileTypeOf(file),
      fileUrl: URL.createObjectURL(file),
    })
    // Back to My SOPs, which announces the success message.
    const state: MySopsLocationState = { uploaded: true }
    navigate(content.cancel.href, { state })
  }

  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{content.subtitle.replace('{department}', activeDepartment.name)}</p>

      <div className="mt-8 max-w-3xl rounded-xl border border-beige bg-white p-5 sm:p-8">
        <form noValidate onSubmit={handleSubmit} className="space-y-6">
          <TextField
            ref={titleRef}
            name="title"
            label={content.fields.title.label}
            placeholder={content.fields.title.placeholder}
            maxLength={TITLE_MAX}
            value={title}
            error={errors.title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => submitAttempted && setErrors((prev) => ({ ...prev, title: validate('title') }))}
          />

          {/* Read-only: new SOPs are added to the active department */}
          <div>
            <p className="mb-1.5 text-sm font-medium text-maroon">{content.fields.department.label}</p>
            <p className="rounded-lg border border-beige bg-beige/50 px-3.5 py-2.5 text-[0.9375rem] text-maroon">
              {activeDepartment.name}
            </p>
          </div>

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
            maxLength={DESCRIPTION_MAX}
            counter={content.fields.description.counter
              .replace('{count}', String(description.length))
              .replace('{max}', String(DESCRIPTION_MAX))}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <CheckboxGroup
            name="coAuthors"
            legend={content.fields.coAuthors.label}
            hint={content.fields.coAuthors.hint}
            emptyText={content.fields.coAuthors.empty}
            options={coAuthorOptions}
            value={coAuthorIds}
            onChange={setCoAuthorIds}
          />

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
