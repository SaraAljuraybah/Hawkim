import { useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { TextField } from '../../components/ui/TextField'
import { adminEn } from '../../content/admin.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import type { GuidelineVersion } from '../../data/mock/types'
import {
  addedDateOf,
  SOURCE_MAX,
  TITLE_MAX,
  validateGuidelineEdit,
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
import { NotFoundPage } from '../NotFoundPage'
import type { AdminRegulationsLocationState } from './AdminRegulationsPage'

const FILE_EXTENSIONS = ['.pdf']
const FILE_MAX_BYTES = 20 * 1024 * 1024

const FIELDS: GuidelineField[] = ['title', 'version', 'issuedDate', 'addedDate', 'fileName', 'source']
/** What can change when editing. */
const EDIT_FIELDS: GuidelineField[] = ['title', 'issuedDate', 'source']

type FieldErrors = Partial<Record<GuidelineField, string>>

/**
 * Add GVP version ("/admin/regulations/new", PBI 20): title, version (entered by the admin: new and
 * higher than the current one), the SFDA issue date, the date it's added to Hawkim (today in
 * Asia/Riyadh, read-only), the guideline PDF and the source link on sfda.gov.sa. After a confirmation
 * it becomes the current version.
 * Edit GVP version ("/admin/regulations/:id/edit"): the same form, pre-filled; only the title, the
 * issue date and the source can change (the version, the added date and the file stay). Both only
 * change this tab's copy.
 * TODO: Upload the guideline file to the backend; for now only its name is kept.
 */
export function RegulationFormPage({ mode = 'add' }: { mode?: 'add' | 'edit' }) {
  const { id } = useParams()
  const { getVersion } = useGuidelines()
  if (mode === 'add') return <GuidelineVersionForm />
  const version = getVersion(id)
  // A different version starts fresh.
  return version ? <GuidelineVersionForm key={version.id} editing={version} /> : <NotFoundPage embedded />
}

function GuidelineVersionForm({ editing }: { editing?: GuidelineVersion }) {
  const text = adminEn.regulationForm
  const names = adminEn.regulations
  useDocumentTitle(adminEn.pageTitle.replace('{page}', editing ? text.editTitle : text.title))
  const { versions, current, addVersion, updateVersion } = useGuidelines()
  const { users } = useUsers()
  const admin = useCurrentUser()
  const navigate = useNavigate()
  const fields = editing ? EDIT_FIELDS : FIELDS

  // Adding: the day the admin opened the page, in Riyadh. Editing: the day the version was added.
  const [addedDate] = useState(() => (editing ? addedDateOf(editing) : riyadhDate(new Date())))
  const [values, setValues] = useState(() => ({
    title: editing?.title ?? '',
    version: editing?.version ?? '',
    issuedDate: editing?.issuedDate ?? '',
    source: editing?.source ?? '',
  }))
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
    'issued-required': text.errors.issuedRequired,
    'issued-after-added': text.errors.issuedAfterAdded,
    'file-required': text.errors.fileRequired,
    'file-not-pdf': text.errors.fileNotPdf,
    'source-required': text.errors.sourceRequired,
    'source-invalid': text.errors.sourceInvalid,
    'source-not-sfda': text.errors.sourceNotSfda,
    'source-too-long': text.errors.sourceTooLong,
  }
  function errorsFor(next: GuidelineVersionInput): FieldErrors {
    const problems = editing ? validateGuidelineEdit(next, editing) : validateGuidelineVersion(next, versions)
    return Object.fromEntries(fields.map((field) => [field, problems[field] && messages[problems[field]]]))
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
    const firstInvalid = fields.find((field) => next[field])
    if (firstInvalid) {
      const refs = { title: titleRef, version: versionRef, issuedDate: issuedRef, addedDate: addedRef, fileName: browseRef, source: sourceRef }
      refs[firstInvalid].current?.focus()
      return
    }
    if (!editing) {
      setConfirming(true)
      return
    }
    // Editing saves at once: nothing becomes current and nothing else changes.
    const updated = updateVersion(editing.id, values, { actorId: admin.id, users })
    const name = names.versionLabel.replace('{title}', updated.title ?? '').replace('{version}', updated.version)
    const state: AdminRegulationsLocationState = { updated: names.updated.replace('{name}', name) }
    navigate(ADMIN_REGULATIONS_PATH, { state })
  }

  function confirm() {
    setConfirming(false)
    // Keep the chosen PDF in this browser, so it can be opened from the version's page (until reload).
    const added = addVersion({ ...input(), fileUrl: URL.createObjectURL(files[0]) }, { actorId: admin.id, users })
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
      <h1 className="mt-5 text-2xl tracking-tight sm:text-3xl">{editing ? text.editTitle : text.title}</h1>
      {!editing && <p className="mt-2 text-text-gray">{text.subtitle}</p>}

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
          readOnly={!!editing}
          hint={editing ? undefined : text.version.hint}
          value={values.version}
          error={errors.version}
          onChange={(event) => setField('version', event.target.value)}
          onBlur={() => blur('version')}
          className={`mt-5 max-w-xs ${editing ? '[&_input]:bg-beige/40' : ''}`}
        />
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <TextField
            ref={issuedRef}
            name="issuedDate"
            type="date"
            label={text.issuedDate.label}
            required
            requiredMark
            max={addedDate}
            value={values.issuedDate}
            error={errors.issuedDate}
            onChange={(event) => setField('issuedDate', event.target.value)}
            onBlur={() => blur('issuedDate')}
          />
          {/* Today in Riyadh, set when the page opened (editing: the day it was added): shown, not edited */}
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
        {editing ? (
          // The file stays as it is.
          <TextField name="file" label={text.file.label} readOnly value={editing.fileName} className="mt-5 [&_input]:bg-beige/40" />
        ) : (
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
        )}
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
          <Button type="submit">{editing ? text.save : text.submit}</Button>
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
