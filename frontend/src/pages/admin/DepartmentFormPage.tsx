import { useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { TextAreaField } from '../../components/ui/TextAreaField'
import { TextField } from '../../components/ui/TextField'
import { adminEn } from '../../content/admin.en'
import type { Department } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import {
  validateDepartment,
  type DepartmentField,
  type DepartmentInput,
  type DepartmentProblem,
} from '../../lib/departmentAdmin'
import { adminDepartmentPath } from '../../lib/routes'
import { useDepartments } from '../../state/departmentsContext'
import { useCurrentUser } from '../../state/sessionContext'
import { useUsers } from '../../state/usersContext'
import { NotFoundPage } from '../NotFoundPage'
import type { DepartmentDetailsLocationState } from './DepartmentDetailsPage'

const FIELDS: DepartmentField[] = ['name', 'initials', 'description']

type FieldErrors = Partial<Record<DepartmentField, string>>

/**
 * Add department ("/admin/departments/new") and Edit department
 * ("/admin/departments/:id/edit"), PBI 13: name (required, unique, up to 60
 * characters), initials (2–3 letters, unique, saved uppercase) and an optional
 * description. On success, the department's page opens. The id never changes.
 */
export function DepartmentFormPage() {
  const { id } = useParams()
  const { activeDepartments } = useDepartments()
  if (id === undefined) return <DepartmentForm key="new" />
  const department = activeDepartments.find((item) => item.id === id)
  if (!department) return <NotFoundPage embedded />
  return <DepartmentForm key={department.id} department={department} />
}

function DepartmentForm({ department }: { department?: Department }) {
  const content = adminEn.departmentForm
  const mode = department ? content.edit : content.add
  useDocumentTitle(adminEn.pageTitle.replace('{page}', mode.title))
  const { departments, addDepartment, updateDepartment } = useDepartments()
  const { users } = useUsers()
  const admin = useCurrentUser()
  const navigate = useNavigate()

  const [values, setValues] = useState<DepartmentInput>({
    name: department?.name ?? '',
    initials: department?.initials ?? '',
    description: department?.description ?? '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const initialsRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)

  const messages: Record<DepartmentProblem, string> = {
    'name-required': content.errors.nameRequired,
    'name-too-long': content.errors.nameTooLong,
    'name-taken': content.errors.nameTaken,
    'initials-invalid': content.errors.initialsInvalid,
    'initials-taken': content.errors.initialsTaken,
    'description-too-long': content.errors.descriptionTooLong,
  }
  function errorsFor(input: DepartmentInput): FieldErrors {
    const problems = validateDepartment(input, departments, department?.id)
    const errorOf = (field: DepartmentField) => {
      const problem = problems[field]
      return problem && messages[problem]
    }
    return { name: errorOf('name'), initials: errorOf('initials'), description: errorOf('description') }
  }

  // Errors are first shown on submit; after that, each field re-validates on blur.
  function blur(field: DepartmentField) {
    if (submitAttempted) setErrors((prev) => ({ ...prev, [field]: errorsFor(values)[field] }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitAttempted(true)
    const next = errorsFor(values)
    // Render the messages before moving focus, so screen readers read them with the field.
    flushSync(() => setErrors(next))
    const firstInvalid = FIELDS.find((field) => next[field])
    if (firstInvalid) {
      const refs = { name: nameRef, initials: initialsRef, description: descriptionRef }
      refs[firstInvalid].current?.focus()
      return
    }
    const actor = { actorId: admin.id, users }
    let targetId: string
    let state: DepartmentDetailsLocationState
    if (department) {
      updateDepartment(department.id, values, actor)
      targetId = department.id
      state = { notice: 'updated' }
    } else {
      targetId = addDepartment(values, actor).id
      state = { notice: 'added' }
    }
    navigate(adminDepartmentPath(targetId), { state })
  }

  const back = department
    ? { label: content.backToDepartment.replace('{name}', department.name), href: adminDepartmentPath(department.id) }
    : content.backToList

  return (
    <>
      <Link
        to={back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {back.label}
      </Link>
      <h1 className="mt-5 text-2xl tracking-tight sm:text-3xl">{mode.title}</h1>
      <p className="mt-2 text-text-gray">{mode.subtitle.replace('{name}', department?.name ?? '')}</p>

      <form noValidate onSubmit={handleSubmit} className="mt-8 max-w-2xl rounded-xl border border-beige bg-white p-5 sm:p-6">
        <TextField
          ref={nameRef}
          name="name"
          autoComplete="off"
          label={content.name.label}
          value={values.name}
          error={errors.name}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
          onBlur={() => blur('name')}
        />
        <TextField
          ref={initialsRef}
          name="initials"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          label={content.initials.label}
          hint={content.initials.hint}
          value={values.initials}
          error={errors.initials}
          onChange={(event) => setValues({ ...values, initials: event.target.value })}
          onBlur={() => blur('initials')}
          className="mt-5 max-w-xs"
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

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" to={back.href}>
            {content.cancel}
          </Button>
          <Button type="submit">{mode.submit}</Button>
        </div>
      </form>
    </>
  )
}
