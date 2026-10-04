import { useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { CheckboxGroup } from '../../components/ui/CheckboxGroup'
import { SelectField } from '../../components/ui/SelectField'
import { TextField } from '../../components/ui/TextField'
import { adminEn } from '../../content/admin.en'
import { usersEn } from '../../content/users.en'
import type { DepartmentId, Permission } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { adminUserPath } from '../../lib/routes'
import { PERMISSIONS, validateNewUser, type NewUser, type NewUserField, type NewUserProblem } from '../../lib/userAdmin'
import { useDepartments } from '../../state/departmentsContext'
import { useUsers } from '../../state/usersContext'
import type { UserDetailsLocationState } from './UserDetailsPage'

const FIELDS: NewUserField[] = ['name', 'email', 'departmentId']

type FieldErrors = Partial<Record<NewUserField, string>>

/**
 * Add user ("/admin/users/new", PBI 15): full name, email (valid and unique) and
 * department are required; permissions are optional. Nothing is added while any
 * required information is missing. On success, the new user's page opens.
 * TODO: Create a real account (an invitation to set a password) once the backend
 * exists. There is no password field: the admin never chooses one.
 */
export function AddUserPage() {
  const content = adminEn.addUser
  useDocumentTitle(adminEn.pageTitle.replace('{page}', content.title))
  const { activeUsers, addUser } = useUsers()
  const { activeDepartments } = useDepartments()
  const navigate = useNavigate()

  const [values, setValues] = useState<NewUser>({ name: '', email: '', departmentId: '', permissions: [] })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const departmentRef = useRef<HTMLSelectElement>(null)

  const messages: Record<NewUserProblem, string> = {
    'name-required': content.errors.nameRequired,
    'email-invalid': content.errors.emailInvalid,
    'email-taken': content.errors.emailTaken,
    'department-required': content.errors.departmentRequired,
  }
  function errorsFor(user: NewUser): FieldErrors {
    const problems = validateNewUser(user, activeUsers)
    const errorOf = (field: NewUserField) => {
      const problem = problems[field]
      return problem && messages[problem]
    }
    return { name: errorOf('name'), email: errorOf('email'), departmentId: errorOf('departmentId') }
  }

  // Errors are first shown on submit; after that, each field re-validates on blur.
  function blur(field: NewUserField) {
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
      const refs = { name: nameRef, email: emailRef, departmentId: departmentRef }
      refs[firstInvalid].current?.focus()
      return
    }
    const created = addUser(values)
    const state: UserDetailsLocationState = { added: true }
    navigate(adminUserPath(created.id), { state })
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
      <p className="mt-2 text-text-gray">{content.subtitle}</p>

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
          ref={emailRef}
          name="email"
          type="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          label={content.email.label}
          hint={content.email.hint}
          value={values.email}
          error={errors.email}
          onChange={(event) => setValues({ ...values, email: event.target.value })}
          onBlur={() => blur('email')}
          className="mt-5"
        />
        <SelectField
          ref={departmentRef}
          name="department"
          label={content.department.label}
          placeholder={content.department.placeholder}
          options={activeDepartments.map((department) => ({ value: department.id, label: department.name }))}
          value={values.departmentId}
          error={errors.departmentId}
          onChange={(event) => setValues({ ...values, departmentId: event.target.value as DepartmentId })}
          onBlur={() => blur('departmentId')}
          className="mt-5"
        />
        <CheckboxGroup
          name="permissions"
          legend={content.permissions.legend}
          hint={content.permissions.hint}
          options={PERMISSIONS.map((permission) => ({
            value: permission,
            label: usersEn.permissions[permission],
            description: adminEn.permissionDescriptions[permission],
          }))}
          value={values.permissions}
          onChange={(next) => setValues({ ...values, permissions: next as Permission[] })}
          className="mt-6"
        />

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" to={content.back.href}>
            {content.cancel}
          </Button>
          <Button type="submit">{content.submit}</Button>
        </div>
      </form>
    </>
  )
}
