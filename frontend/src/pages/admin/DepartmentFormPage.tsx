import { useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { PageLoading } from '../../components/ui/PageLoading'
import { SelectField } from '../../components/ui/SelectField'
import { TextAreaField } from '../../components/ui/TextAreaField'
import { TextField } from '../../components/ui/TextField'
import { adminEn } from '../../content/admin.en'
import { organizationAdminEn as orgText } from '../../content/organizationAdmin.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useOrganizationManagement } from '../../hooks/useOrganizationManagement'
import {
  DEPARTMENT_FORM_FIELDS,
  departmentFormProblems,
  divisionIsOptional,
  formInitials,
  initialDivisionId,
  submitDepartmentForm,
  type DepartmentFormField,
  type DepartmentFormProblem,
  type DepartmentFormValues,
} from '../../lib/departmentForm'
import { adminDepartmentPath, NEW_DEPARTMENT_DIVISION_PARAM } from '../../lib/routes'
import { saveDepartment, type ManagedDepartment, type ManagementSnapshot } from '../../services/organizationAdmin'
import { useDepartments } from '../../state/departmentsContext'
import { NotFoundPage } from '../NotFoundPage'

type FieldErrors = Partial<Record<DepartmentFormField, string>>

/**
 * Add department ("/admin/departments/new", optionally "?division=<id>") and Edit department
 * ("/admin/departments/:id/edit"), PBI 13. Reads the admin management snapshot
 * (get_divisions_departments) and saves through save_department, which enforces the same rules,
 * the active division and the expected version on the server. Initials
 * are not a field: they are generated from the name (lib/departmentInitials.ts). A new department needs a division;
 * a legacy department without one may stay unassigned. On success, the department's page opens.
 */
export function DepartmentFormPage() {
  const { id } = useParams()
  const management = useOrganizationManagement()
  if (!management.data) {
    if (management.error) {
      return (
        <div role="alert" className="max-w-2xl">
          <p className="text-status-rejected-fg">{orgText.loadFailed}</p>
          <Button variant="secondary" className="mt-4" onClick={() => void management.refresh()}>{orgText.retry}</Button>
        </div>
      )
    }
    return <PageLoading />
  }
  if (id === undefined) return <DepartmentForm key="new" snapshot={management.data} />
  const department = management.data.departments.find((item) => item.id === id)
  if (!department) return <NotFoundPage embedded />
  return <DepartmentForm key={department.id} snapshot={management.data} department={department} />
}

function DepartmentForm({ snapshot, department }: { snapshot: ManagementSnapshot; department?: ManagedDepartment }) {
  const content = adminEn.departmentForm
  const mode = department ? content.edit : content.add
  useDocumentTitle(adminEn.pageTitle.replace('{page}', mode.title))
  const { reload } = useDepartments()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const divisions = snapshot.divisions
  const requestedDivision = department ? null : params.get(NEW_DEPARTMENT_DIVISION_PARAM)
  const requestedIsActive = !!requestedDivision && divisions.some((division) => division.id === requestedDivision)
  // Decided once: a later snapshot refresh doesn't change what the admin is editing.
  const [divisionOptional] = useState(() => divisionIsOptional(department))
  // The version that was edited: the server refuses the save if someone changed it since.
  const [expectedUpdatedAt] = useState(department?.updated_at)

  const [values, setValues] = useState<DepartmentFormValues>({
    divisionId: initialDivisionId(snapshot, department, requestedDivision),
    name: department?.name ?? '',
    description: department?.description ?? '',
    email: department?.email ?? '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const divisionRef = useRef<HTMLSelectElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const saveErrorRef = useRef<HTMLParagraphElement>(null)

  const messages: Record<DepartmentFormProblem, string> = {
    'division-required': orgText.requiredDivision,
    'name-required': content.errors.nameRequired,
    'name-too-long': content.errors.nameTooLong,
    'name-taken': content.errors.nameTaken,
    // Initials are generated, so these can't happen; listed for completeness.
    'initials-invalid': orgText.invalid,
    'initials-taken': orgText.duplicate,
    'description-too-long': content.errors.descriptionTooLong,
    'email-invalid': content.errors.emailInvalid,
  }
  function errorsFor(input: DepartmentFormValues): FieldErrors {
    const problems = departmentFormProblems(input, snapshot, { editingId: department?.id, divisionOptional })
    const errorOf = (field: DepartmentFormField) => {
      const problem = problems[field]
      return problem && messages[problem]
    }
    return { divisionId: errorOf('divisionId'), name: errorOf('name'), description: errorOf('description'), email: errorOf('email') }
  }

  // Errors are first shown on submit; after that, each field re-validates on blur.
  function blur(field: DepartmentFormField) {
    if (submitAttempted) setErrors((prev) => ({ ...prev, [field]: errorsFor(values)[field] }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setSubmitAttempted(true)
    const next = errorsFor(values)
    // Render the messages before moving focus, so screen readers read them with the field.
    flushSync(() => { setErrors(next); setSaveError('') })
    const firstInvalid = DEPARTMENT_FORM_FIELDS.find((field) => next[field])
    if (firstInvalid) {
      const refs = { divisionId: divisionRef, name: nameRef, description: descriptionRef, email: emailRef }
      refs[firstInvalid].current?.focus()
      return
    }
    setBusy(true)
    try {
      // The saved department is in the shared list before its page opens.
      const { targetId, state } = await submitDepartmentForm(values, formInitials(values, snapshot, department), department, expectedUpdatedAt, { save: saveDepartment, reload })
      navigate(adminDepartmentPath(targetId), { state })
    } catch (reason) {
      flushSync(() => { setBusy(false); setSaveError((reason as Error).message) })
      saveErrorRef.current?.focus()
    }
  }

  const back = department
    ? { label: content.backToDepartment.replace('{name}', department.name), href: adminDepartmentPath(department.id) }
    : content.backToList

  if (department?.deletion_job_id) {
    return (
      <>
        <BackLink {...back} />
        <h1 className="mt-5 text-2xl tracking-tight sm:text-3xl">{mode.title}</h1>
        <p role="alert" className="mt-6 max-w-2xl text-status-rejected-fg">{orgText.departmentPendingCleanup}</p>
      </>
    )
  }

  const divisionOptions = [
    ...(divisionOptional ? [{ value: '', label: orgText.noDivision }] : []),
    ...divisions.map((division) => ({ value: division.id, label: division.name })),
  ]

  return (
    <>
      <BackLink {...back} />
      <h1 className="mt-5 text-2xl tracking-tight sm:text-3xl">{mode.title}</h1>
      <p className="mt-2 text-text-gray">{mode.subtitle.replace('{name}', department?.name ?? '')}</p>

      <form noValidate onSubmit={handleSubmit} aria-busy={busy || undefined} className="mt-8 max-w-2xl rounded-xl border border-beige bg-white p-5 sm:p-6">
        <SelectField
          ref={divisionRef}
          name="division"
          label={orgText.division}
          required={!divisionOptional}
          requiredMark={!divisionOptional}
          placeholder={divisionOptional ? undefined : orgText.selectDivision}
          hint={requestedDivision && !requestedIsActive ? orgText.divisionLinkUnavailable : undefined}
          options={divisionOptions}
          value={values.divisionId}
          error={errors.divisionId}
          onChange={(event) => setValues({ ...values, divisionId: event.target.value })}
          onBlur={() => blur('divisionId')}
        />
        <TextField
          ref={nameRef}
          name="name"
          autoComplete="off"
          label={content.name.label}
          required
          requiredMark
          value={values.name}
          error={errors.name}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
          onBlur={() => blur('name')}
          className="mt-5"
        />
        <TextAreaField
          ref={descriptionRef}
          name="description"
          rows={3}
          label={content.description.label}
          hint={content.description.hint}
          value={values.description}
          error={errors.description}
          onChange={(event) => setValues({ ...values, description: event.target.value })}
          onBlur={() => blur('description')}
          className="mt-5"
        />
        <TextField
          ref={emailRef}
          name="email"
          type="email"
          autoComplete="off"
          label={content.email.label}
          placeholder={content.email.placeholder}
          value={values.email}
          error={errors.email}
          onChange={(event) => setValues({ ...values, email: event.target.value })}
          onBlur={() => blur('email')}
          className="mt-5"
        />

        {/* Refusals from the server (duplicate, changed by someone else, not allowed…). */}
        <div role="alert">
          {saveError && (
            <p ref={saveErrorRef} tabIndex={-1} className="mt-6 rounded-lg border border-status-rejected-fg/25 bg-status-rejected-bg px-4 py-3 text-sm text-status-rejected-fg focus:outline-none">
              {saveError}
            </p>
          )}
        </div>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" to={back.href}>
            {content.cancel}
          </Button>
          <Button type="submit" disabled={busy}>{busy ? orgText.saving : mode.submit}</Button>
        </div>
      </form>
    </>
  )
}

function BackLink({ label, href }: { label: string; href: string }) {
  return (
    <Link
      to={href}
      className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
    >
      <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
      {label}
    </Link>
  )
}
