import { useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { TextField } from '../../components/ui/TextField'
import { adminEn } from '../../content/admin.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import {
  SOURCE_MAX,
  TITLE_MAX,
  validateGuidelineVersion,
  type GuidelineField,
  type GuidelineProblem,
  type GuidelineVersionInput,
} from '../../lib/guidelines'
import { riyadhDate } from '../../lib/riyadhWorkingDays'
import { ADMIN_REGULATIONS_PATH } from '../../lib/routes'
import { useGuidelines } from '../../state/guidelinesContext'
import { useCurrentUser } from '../../state/sessionContext'
import { useUsers } from '../../state/usersContext'
import type { AdminRegulationsLocationState } from './AdminRegulationsPage'

const FILE_EXTENSIONS = ['.pdf']
const FILE_MAX_BYTES = 20 * 1024 * 1024

const FIELDS: GuidelineField[] = ['title', 'version', 'issuedDate', 'addedDate', 'fileName', 'source']

type FieldErrors = Partial<Record<GuidelineField, string>>

/**
 * Add GVP version ("/admin/regulations/new", PBI 20): title, version (entered by the admin: new and
 * higher than the current one), optional SFDA issue date, the date it's added to Hawkim (today in
 * Asia/Riyadh, read-only), the guideline PDF and the source link on sfda.gov.sa. After a confirmation it becomes
 * the current version.
 * TODO: Upload the guideline file to the backend; for now only its name is kept.
 */
export function RegulationFormPage() {
  const text = adminEn.regulationForm
  useDocumentTitle(adminEn.pageTitle.replace('{page}', text.title))
  const { versions, current, addVersion } = useGuidelines()
  const { users } = useUsers()
  const admin = useCurrentUser()
  const navigate = useNavigate()

  // The day the admin opened the page, in Riyadh.
  const [addedDate] = useState(() => riyadhDate(new Date()))
  const [values, setValues] = useState({ title: '', version: '', issuedDate: '', source: '' })
  const [files, setFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const versionRef = useRef<HTMLInputElement>(null)
  const issuedRef = useRef<HTMLInputElement>(null)
  const addedRef = useRef<HTMLInputElement>(null)
  const browseRef = useRef<HTMLButtonElement>(null)
  const sourceRef = useRef<HTMLInputElement>(null)

  const input = (fileList = files): GuidelineVersionInput => ({ ...values, addedDate, fileName: fileList[0]?.name ?? '' })

  const messages: Record<GuidelineProblem, string> = {
    'title-required': text.errors.titleRequired,
    'title-too-long': text.errors.titleTooLong,
    'version-invalid': text.errors.versionInvalid,
    'version-exists': text.errors.versionExists.replace('{version}', values.version.trim()),
    'version-not-higher': text.errors.versionNotHigher.replace('{current}', current.version),
    'added-required': text.errors.addedRequired,
    'issued-after-added': text.errors.issuedAfterAdded,
    'file-required': text.errors.fileRequired,
    'file-not-pdf': text.errors.fileNotPdf,
    'source-required': text.errors.sourceRequired,
    'source-invalid': text.errors.sourceInvalid,
    'source-not-sfda': text.errors.sourceNotSfda,
    'source-too-long': text.errors.sourceTooLong,
  }
  function errorsFor(next: GuidelineVersionInput): FieldErrors {
    const problems = validateGuidelineVersion(next, versions)
    return Object.fromEntries(FIELDS.map((field) => [field, problems[field] && messages[problems[field]]]))
  }

  function setField(field: keyof typeof values, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }
  // Errors are first shown on submit; after that, each field re-validates on blur.
  function blur(field: GuidelineField) {
    if (submitAttempted) setErrors((prev) => ({ ...prev, [field]: errorsFor(input())[field] }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitAttempted(true)
    const next = errorsFor(input())
    // Render the messages before moving focus, so screen readers read them with the field.
    flushSync(() => setErrors(next))
    const firstInvalid = FIELDS.find((field) => next[field])
    if (firstInvalid) {
      const refs = { title: titleRef, version: versionRef, issuedDate: issuedRef, addedDate: addedRef, fileName: browseRef, source: sourceRef }
      refs[firstInvalid].current?.focus()
      return
    }
    setConfirming(true)
  }

  function confirm() {
    setConfirming(false)
    const added = addVersion(input(), { actorId: admin.id, users })
    const state: AdminRegulationsLocationState = { added: added.version }
    navigate(ADMIN_REGULATIONS_PATH, { state })
  }

  return (
    <>
      <Link
        to={text.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {text.back.label}
      </Link>
      <h1 className="mt-5 text-2xl tracking-tight sm:text-3xl">{text.title}</h1>
      <p className="mt-2 text-text-gray">{text.subtitle}</p>

      <form ref={formRef} noValidate onSubmit={handleSubmit} className="mt-8 max-w-2xl rounded-xl border border-beige bg-white p-5 sm:p-6">
        <TextField
          ref={titleRef}
          name="title"
          autoComplete="off"
          label={text.titleField.label}
          required
          requiredMark
          maxLength={TITLE_MAX}
          value={values.title}
          error={errors.title}
          onChange={(event) => setField('title', event.target.value)}
          onBlur={() => blur('title')}
        />
        <TextField
          ref={versionRef}
          name="version"
          inputMode="decimal"
          autoComplete="off"
          label={text.version.label}
          required
          requiredMark
          hint={text.version.hint}
          value={values.version}
          error={errors.version}
          onChange={(event) => setField('version', event.target.value)}
          onBlur={() => blur('version')}
          className="mt-5 max-w-xs"
        />
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <TextField
            ref={issuedRef}
            name="issuedDate"
            type="date"
            label={text.issuedDate.label}
            max={addedDate}
            value={values.issuedDate}
            error={errors.issuedDate}
            onChange={(event) => setField('issuedDate', event.target.value)}
            onBlur={() => blur('issuedDate')}
          />
          {/* Today in Riyadh, set when the page opened: shown, not edited */}
          <TextField
            ref={addedRef}
            name="addedDate"
            type="date"
            label={text.addedDate.label}
            required
            requiredMark
            readOnly
            value={addedDate}
            error={errors.addedDate}
            className="[&_input]:bg-beige/40"
          />
        </div>
        <FileDropzone
          files={files}
          onChange={(next) => {
            setFiles(next)
            if (submitAttempted) setErrors((prev) => ({ ...prev, fileName: errorsFor(input(next)).fileName }))
          }}
          extensions={FILE_EXTENSIONS}
          maxSizeBytes={FILE_MAX_BYTES}
          text={text.file}
          browseRef={browseRef}
          multiple={false}
          error={errors.fileName}
          className="mt-5"
        />
        <TextField
          ref={sourceRef}
          name="source"
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          label={text.source.label}
          placeholder={text.source.placeholder}
          required
          requiredMark
          maxLength={SOURCE_MAX}
          value={values.source}
          error={errors.source}
          onChange={(event) => setField('source', event.target.value)}
          onBlur={() => blur('source')}
          className="mt-5"
        />

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" to={text.back.href}>
            {text.cancel}
          </Button>
          <Button type="submit">{text.submit}</Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        title={text.dialog.title.replace('{version}', values.version.trim())}
        description={text.dialog.description}
        cancelLabel={text.dialog.cancel}
        confirmLabel={text.dialog.confirm}
        onConfirm={confirm}
        onCancel={() => {
          setConfirming(false)
          formRef.current?.querySelector<HTMLButtonElement>('button[type=submit]')?.focus()
        }}
      />
    </>
  )
}
