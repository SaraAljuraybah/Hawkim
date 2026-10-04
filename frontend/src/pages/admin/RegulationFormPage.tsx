import { useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { TextAreaField } from '../../components/ui/TextAreaField'
import { TextField } from '../../components/ui/TextField'
import { adminEn } from '../../content/admin.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import {
  SUMMARY_MAX,
  validateGuidelineVersion,
  type GuidelineField,
  type GuidelineProblem,
  type GuidelineVersionInput,
} from '../../lib/guidelines'
import { ADMIN_REGULATIONS_PATH } from '../../lib/routes'
import { useGuidelines } from '../../state/guidelinesContext'
import { useCurrentUser } from '../../state/sessionContext'
import { useUsers } from '../../state/usersContext'
import type { AdminRegulationsLocationState } from './AdminRegulationsPage'

const FILE_EXTENSIONS = ['.pdf']
const FILE_MAX_BYTES = 20 * 1024 * 1024

const FIELDS: GuidelineField[] = ['version', 'issuedDate', 'effectiveDate', 'fileName', 'summary']

type FieldErrors = Partial<Record<GuidelineField, string>>

/**
 * Add GVP version ("/admin/regulations/new", PBI 20): version (higher than the
 * current one), optional issued date, effective date, the guideline PDF and an
 * optional summary of changes. After a confirmation it becomes the current version.
 * TODO: Upload the guideline file to the backend; for now only its name is kept.
 */
export function RegulationFormPage() {
  const text = adminEn.regulationForm
  useDocumentTitle(adminEn.pageTitle.replace('{page}', text.title))
  const { current, addVersion } = useGuidelines()
  const { users } = useUsers()
  const admin = useCurrentUser()
  const navigate = useNavigate()

  const [values, setValues] = useState({ version: '', issuedDate: '', effectiveDate: '', summary: '' })
  const [files, setFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const versionRef = useRef<HTMLInputElement>(null)
  const issuedRef = useRef<HTMLInputElement>(null)
  const effectiveRef = useRef<HTMLInputElement>(null)
  const browseRef = useRef<HTMLButtonElement>(null)
  const summaryRef = useRef<HTMLTextAreaElement>(null)

  const input = (fileList = files): GuidelineVersionInput => ({ ...values, fileName: fileList[0]?.name ?? '' })

  const messages: Record<GuidelineProblem, string> = {
    'version-invalid': text.errors.versionInvalid,
    'version-not-higher': text.errors.versionNotHigher.replace('{current}', current.version),
    'effective-required': text.errors.effectiveRequired,
    'issued-after-effective': text.errors.issuedAfterEffective,
    'file-required': text.errors.fileRequired,
    'file-not-pdf': text.errors.fileNotPdf,
    'summary-too-long': text.errors.summaryTooLong,
  }
  function errorsFor(next: GuidelineVersionInput): FieldErrors {
    const problems = validateGuidelineVersion(next, current)
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
      const refs = { version: versionRef, issuedDate: issuedRef, effectiveDate: effectiveRef, fileName: browseRef, summary: summaryRef }
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
          ref={versionRef}
          name="version"
          inputMode="decimal"
          autoComplete="off"
          label={text.version.label}
          hint={text.version.hint}
          value={values.version}
          error={errors.version}
          onChange={(event) => setField('version', event.target.value)}
          onBlur={() => blur('version')}
          className="max-w-xs"
        />
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <TextField
            ref={issuedRef}
            name="issuedDate"
            type="date"
            label={text.issuedDate.label}
            value={values.issuedDate}
            error={errors.issuedDate}
            onChange={(event) => setField('issuedDate', event.target.value)}
            onBlur={() => blur('issuedDate')}
          />
          <TextField
            ref={effectiveRef}
            name="effectiveDate"
            type="date"
            label={text.effectiveDate.label}
            hint={text.effectiveDate.hint}
            value={values.effectiveDate}
            error={errors.effectiveDate}
            onChange={(event) => setField('effectiveDate', event.target.value)}
            onBlur={() => {
              blur('effectiveDate')
              blur('issuedDate')
            }}
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
        <TextAreaField
          ref={summaryRef}
          name="summary"
          rows={4}
          maxLength={SUMMARY_MAX}
          label={text.summary.label}
          counter={text.summary.counter.replace('{count}', String(values.summary.length)).replace('{max}', String(SUMMARY_MAX))}
          value={values.summary}
          error={errors.summary}
          onChange={(event) => setField('summary', event.target.value)}
          onBlur={() => blur('summary')}
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
