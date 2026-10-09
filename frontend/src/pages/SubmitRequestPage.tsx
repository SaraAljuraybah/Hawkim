import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { CircleCheck, LoaderCircle } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { FileDropzone } from '../components/ui/FileDropzone'
import { SelectField } from '../components/ui/SelectField'
import { TextAreaField } from '../components/ui/TextAreaField'
import { TextField } from '../components/ui/TextField'
import { requestsEn } from '../content/requests.en'
import type { DepartmentId, RequestType } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { REQUEST_PREFILL_PARAMS } from '../lib/routes'
import { useDepartments } from '../state/departmentsContext'
import { useCurrentUser } from '../state/sessionContext'
import { useRequests } from '../state/requestsContext'

const TITLE_MAX = 100
const DESCRIPTION_MAX = 1000
const ATTACHMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.png']
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024 // 10 MB
/** Simulated delay so the loading state can be seen (no backend yet). */
const SUBMIT_DELAY_MS = 600

type Field = 'type' | 'departmentId' | 'title' | 'description'
type Values = { type: RequestType | ''; departmentId: DepartmentId | ''; title: string; description: string }
type FieldErrors = Partial<Record<Field, string>>

const emptyValues: Values = { type: '', departmentId: '', title: '', description: '' }

/**
 * Initial values from the URL, e.g. ?type=department-access&department=quality-assurance
 * (used by "Request access" on locked SOPs). Unknown values are ignored, and the
 * department is only kept for Department Access and when it is not the user's own.
 */
function prefillFromParams(
  params: URLSearchParams,
  typeOptions: RequestType[],
  departmentOptions: DepartmentId[],
): Values {
  const type = params.get(REQUEST_PREFILL_PARAMS.type) as RequestType | null
  const department = params.get(REQUEST_PREFILL_PARAMS.department) as DepartmentId | null
  const validType = type && typeOptions.includes(type) ? type : ''
  const validDepartment =
    validType === 'department-access' && department && departmentOptions.includes(department) ? department : ''
  return { ...emptyValues, type: validType, departmentId: validDepartment }
}

/** Submit a Request ("/requests/new"): form, then a confirmation panel. */
export function SubmitRequestPage() {
  const content = requestsEn.submit
  const typeLabels = requestsEn.types
  useDocumentTitle(content.pageTitle)

  const { addRequest } = useRequests()
  const user = useCurrentUser()
  const { activeDepartments } = useDepartments()

  const [searchParams] = useSearchParams()
  const [files, setFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const typeRef = useRef<HTMLSelectElement>(null)
  const departmentRef = useRef<HTMLSelectElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null)
  const focusTypeAfterReset = useRef(false)

  // Department access is to *another* department, so the user's own is left out.
  const departmentOptions = activeDepartments
    .filter((department) => department.id !== user.departmentId)
    .map((department) => ({ value: department.id, label: department.name }))
  const typeOptions = (Object.keys(typeLabels) as RequestType[]).map((type) => ({ value: type, label: typeLabels[type] }))

  // Start from the URL prefill (e.g. "Request access" on a locked SOP), if any.
  const [values, setValues] = useState<Values>(() =>
    prefillFromParams(
      searchParams,
      typeOptions.map((option) => option.value),
      departmentOptions.map((option) => option.value),
    ),
  )
  const needsDepartment = values.type === 'department-access'

  // After submitting, move focus to the confirmation heading; after "Submit another
  // request", move it back to the first field.
  useEffect(() => {
    if (submitted) confirmationHeadingRef.current?.focus()
    else if (focusTypeAfterReset.current) {
      focusTypeAfterReset.current = false
      typeRef.current?.focus()
    }
  }, [submitted])

  /** Returns the error message for a field, or undefined when it is valid. */
  function validateField(field: Field, current: Values): string | undefined {
    switch (field) {
      case 'type':
        return current.type ? undefined : content.errors.typeRequired
      case 'departmentId':
        return current.type !== 'department-access' || current.departmentId ? undefined : content.errors.departmentRequired
      case 'title':
        return current.title.trim() ? undefined : content.errors.titleRequired
      case 'description':
        return current.description.trim() ? undefined : content.errors.descriptionRequired
    }
  }

  function update<K extends keyof Values>(field: K, value: Values[K]) {
    setValues((prev) => {
      const next = { ...prev, [field]: value }
      // Only Department Access has a department.
      if (field === 'type' && value !== 'department-access') next.departmentId = ''
      return next
    })
    if (field === 'type' && value !== 'department-access') {
      setErrors((prev) => ({ ...prev, departmentId: undefined }))
    }
  }

  // Errors are first shown on submit; after that, each field re-validates on blur.
  function handleBlur(field: Field) {
    if (!submitAttempted) return
    setErrors((prev) => ({ ...prev, [field]: validateField(field, values) }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    setSubmitAttempted(true)
    const order: Field[] = ['type', 'departmentId', 'title', 'description']
    const nextErrors: FieldErrors = Object.fromEntries(order.map((field) => [field, validateField(field, values)]))
    flushSync(() => setErrors(nextErrors))

    const refs = { type: typeRef, departmentId: departmentRef, title: titleRef, description: descriptionRef }
    const firstInvalid = order.find((field) => nextErrors[field])
    if (firstInvalid) {
      refs[firstInvalid].current?.focus()
      return
    }

    setSubmitting(true)
    // TODO: Send the request (and upload the attachments) to the backend API.
    await new Promise((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS))
    addRequest({
      type: values.type as RequestType,
      departmentId: needsDepartment ? (values.departmentId as DepartmentId) : undefined,
      title: values.title.trim(),
      description: values.description.trim(),
    })
    setSubmitting(false)
    setSubmitted(true)
  }

  function startAnotherRequest() {
    setValues(emptyValues)
    setFiles([])
    setErrors({})
    setSubmitAttempted(false)
    focusTypeAfterReset.current = true
    setSubmitted(false)
  }

  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{content.subtitle}</p>

      <div className="mt-8 max-w-[45rem] rounded-xl border border-beige bg-white p-5 sm:p-8">
        {submitted ? (
          /* Confirmation */
          <div role="status" className="flex flex-col items-center py-6 text-center">
            <span
              aria-hidden="true"
              className="inline-flex size-14 items-center justify-center rounded-full bg-status-approved-bg text-status-approved-fg"
            >
              <CircleCheck className="size-7" strokeWidth={1.75} />
            </span>
            <h2 ref={confirmationHeadingRef} tabIndex={-1} className="mt-5 text-xl focus:outline-none">
              {content.confirmation.title}
            </h2>
            <p className="mt-2 max-w-md text-text-gray">{content.confirmation.text}</p>
            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Button to={content.confirmation.viewRequests.href}>{content.confirmation.viewRequests.label}</Button>
              <Button variant="secondary" onClick={startAnotherRequest}>
                {content.confirmation.submitAnother}
              </Button>
            </div>
          </div>
        ) : (
          /* Form */
          <form noValidate onSubmit={handleSubmit} className="space-y-6">
            <SelectField
              ref={typeRef}
              name="type"
              label={content.fields.type.label}
              placeholder={content.fields.type.placeholder}
              options={typeOptions}
              value={values.type}
              error={errors.type}
              onChange={(e) => update('type', e.target.value as RequestType)}
              onBlur={() => handleBlur('type')}
            />

            {needsDepartment && (
              <SelectField
                ref={departmentRef}
                name="department"
                label={content.fields.department.label}
                placeholder={content.fields.department.placeholder}
                options={departmentOptions}
                value={values.departmentId}
                error={errors.departmentId}
                onChange={(e) => update('departmentId', e.target.value as DepartmentId)}
                onBlur={() => handleBlur('departmentId')}
              />
            )}

            <TextField
              ref={titleRef}
              name="title"
              label={content.fields.title.label}
              placeholder={content.fields.title.placeholder}
              maxLength={TITLE_MAX}
              value={values.title}
              error={errors.title}
              onChange={(e) => update('title', e.target.value)}
              onBlur={() => handleBlur('title')}
            />

            <TextAreaField
              ref={descriptionRef}
              name="description"
              label={content.fields.description.label}
              placeholder={content.fields.description.placeholder}
              maxLength={DESCRIPTION_MAX}
              counter={content.fields.description.counter
                .replace('{count}', String(values.description.length))
                .replace('{max}', String(DESCRIPTION_MAX))}
              value={values.description}
              error={errors.description}
              onChange={(e) => update('description', e.target.value)}
              onBlur={() => handleBlur('description')}
            />

            {/* TODO: Upload attachments with the request once the backend exists (they are not saved yet). */}
            <FileDropzone
              files={files}
              onChange={setFiles}
              extensions={ATTACHMENT_EXTENSIONS}
              maxSizeBytes={ATTACHMENT_MAX_BYTES}
              text={content.fields.attachments}
            />

            <div className="flex flex-col-reverse gap-3 border-t border-beige pt-6 sm:flex-row sm:justify-end">
              <Button to={content.cancel.href} variant="secondary">
                {content.cancel.label}
              </Button>
              <Button type="submit" aria-disabled={submitting || undefined}>
                {submitting && (
                  <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />
                )}
                {submitting ? content.submit.loadingLabel : content.submit.label}
              </Button>
            </div>
          </form>
        )}
      </div>
    </>
  )
}
