import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { adminEn } from '../../content/admin.en'
import { usersEn } from '../../content/users.en'
import type { Permission, User } from '../../data/mock/types'
import {
  defaultDivision,
  departmentsInDivision,
  PERMISSIONS,
  POSITION_MAX,
  userFormChanged,
  validateNewUser,
  type NewUser,
  type NewUserField,
  type NewUserProblem,
} from '../../lib/userAdmin'
import { useDepartments } from '../../state/departmentsContext'
import { Button } from '../ui/Button'
import { CheckboxGroup } from '../ui/CheckboxGroup'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { PhoneField } from '../ui/PhoneField'
import { SelectCombobox } from '../ui/SelectCombobox'
import { TextField } from '../ui/TextField'
import { DivisionField } from './DivisionField'

const FIELDS: NewUserField[] = ['name', 'email', 'phone', 'divisionId', 'departmentId', 'position', 'permissions']

type FieldErrors = Partial<Record<NewUserField, string>>

interface UserFormProps {
  /** The values it starts with. Without a divisionId, the default follows the departments. */
  initial: NewUser
  /** The active users whose emails are taken (when editing: everyone except that user). */
  otherUsers: User[]
  submitLabel: string
  /** The submit button's text while waiting for onSubmit. Default: submitLabel. */
  busyLabel?: string
  /** Shown above the buttons (e.g. why saving was refused). */
  notice?: ReactNode
  /** Called whenever a field changes. */
  onEdit?: () => void
  /** Called with valid values only; it may be async (shows a busy state, and can't be sent twice). */
  onSubmit: (user: NewUser) => void | Promise<void>
}

/**
 * The form of Add User and Edit User: full name, email (valid and unique), phone number (a Saudi
 * mobile number), division, department (one of that division's) and position are required;
 * permissions are optional. Division comes first: the department list waits for it, and when "No
 * Division" is the only choice it is chosen from the start. Cancel asks first when anything differs
 * from the values it opened with.
 */
export function UserForm({ initial, otherUsers, submitLabel, busyLabel, notice, onEdit, onSubmit }: UserFormProps) {
  const content = adminEn.addUser
  const { activeDepartments } = useDepartments()

  const [values, setValues] = useState<NewUser>(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const navigate = useNavigate()
  const cancelRef = useRef<HTMLAnchorElement | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const divisionRef = useRef<HTMLInputElement>(null)
  const departmentRef = useRef<HTMLInputElement>(null)
  const positionRef = useRef<HTMLInputElement>(null)
  const permissionsRef = useRef<HTMLInputElement>(null)

  const division = values.divisionId ?? defaultDivision(activeDepartments)
  const user: NewUser = { ...values, divisionId: division }
  // Compared with the values it opened with, the default division filled in the same way.
  const changed = userFormChanged({ ...initial, divisionId: initial.divisionId ?? defaultDivision(activeDepartments) }, user)
  const departmentOptions = departmentsInDivision(activeDepartments, division).map((department) => ({ value: department.id, label: department.name }))

  const messages: Record<NewUserProblem, string> = {
    'name-required': content.errors.nameRequired,
    'email-invalid': content.errors.emailInvalid,
    'email-taken': content.errors.emailTaken,
    'phone-required': content.errors.phoneRequired,
    'phone-invalid': content.errors.phoneInvalid,
    'division-required': content.errors.divisionRequired,
    'department-required': content.errors.departmentRequired,
    'position-required': content.errors.positionRequired,
    'position-too-long': content.errors.positionTooLong.replace('{max}', String(POSITION_MAX)),
    'approver-outside-quality': content.errors.approverOutsideQuality,
  }
  function errorsFor(next: NewUser): FieldErrors {
    const problems = validateNewUser(next, otherUsers, activeDepartments)
    const errorOf = (field: NewUserField) => {
      const problem = problems[field]
      return problem && messages[problem]
    }
    return Object.fromEntries(FIELDS.map((field) => [field, errorOf(field)]))
  }

  function change(next: NewUser) {
    setValues(next)
    onEdit?.()
    // After a Save attempt: Approver and the department decide this together, and neither blurs to re-check it.
    if (submitAttempted) setErrors((prev) => ({ ...prev, permissions: errorsFor(next).permissions }))
  }

  // Errors are first shown on submit; after that, each field re-validates on blur.
  function blur(field: NewUserField, next: NewUser = user) {
    if (submitAttempted) setErrors((prev) => ({ ...prev, [field]: errorsFor(next)[field] }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setSubmitAttempted(true)
    const next = errorsFor(user)
    // Render the messages before moving focus, so screen readers read them with the field.
    flushSync(() => setErrors(next))
    const firstInvalid = FIELDS.find((field) => next[field])
    if (firstInvalid) {
      const refs = { name: nameRef, email: emailRef, phone: phoneRef, divisionId: divisionRef, departmentId: departmentRef, position: positionRef, permissions: permissionsRef }
      refs[firstInvalid].current?.focus()
      return
    }
    const pending = onSubmit(user)
    if (!(pending instanceof Promise)) return
    setBusy(true)
    try {
      await pending
    } finally {
      setBusy(false)
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="mt-8 max-w-2xl rounded-xl border border-beige bg-white p-5 sm:p-6">
      <TextField
        ref={nameRef}
        name="name"
        autoComplete="off"
        label={content.name.label}
        required
        requiredMark
        value={values.name}
        error={errors.name}
        onChange={(event) => change({ ...values, name: event.target.value })}
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
        required
        requiredMark
        value={values.email}
        error={errors.email}
        onChange={(event) => change({ ...values, email: event.target.value })}
        onBlur={() => blur('email')}
        className="mt-5"
      />
      {/* "+9665" before the field and the 8 digits in it; values.phone keeps "+9665" and the digits */}
      <PhoneField
        ref={phoneRef}
        name="phone"
        label={content.phone.label}
        required
        requiredMark
        hint={content.phone.hint}
        invalidMessage={content.errors.phoneInvalid}
        value={values.phone}
        error={errors.phone}
        onChange={(phone) => change({ ...values, phone })}
        onBlur={() => blur('phone')}
        className="mt-5"
      />
      <DivisionField
        inputRef={divisionRef}
        departments={activeDepartments}
        content={content.division}
        value={division}
        error={errors.divisionId}
        onChange={(divisionId) => {
          if (divisionId === division) return
          // A department belongs to its division, so a new division starts without one.
          change({ ...values, divisionId, departmentId: '' })
          setErrors((prev) => ({ ...prev, departmentId: undefined }))
        }}
        onBlur={(divisionId) => blur('divisionId', { ...user, divisionId })}
        className="mt-5"
      />
      <SelectCombobox
        // A fresh list (and no leftover typed text) for each division.
        key={division}
        inputRef={departmentRef}
        name="department"
        label={content.department.label}
        placeholder={division ? content.department.placeholder : content.department.selectDivisionFirst}
        options={departmentOptions}
        value={values.departmentId}
        error={errors.departmentId}
        required
        requiredMark
        disabled={!division}
        toggleLabel={content.department.toggle}
        noMatchesText={content.department.noMatches}
        onChange={(departmentId) => change({ ...values, departmentId })}
        onBlur={(departmentId) => blur('departmentId', { ...user, departmentId })}
        className="mt-5"
      />
      <TextField
        ref={positionRef}
        name="position"
        autoComplete="off"
        label={content.position.label}
        required
        requiredMark
        maxLength={POSITION_MAX}
        value={values.position}
        error={errors.position}
        onChange={(event) => change({ ...values, position: event.target.value })}
        onBlur={() => blur('position')}
        className="mt-5"
      />
      <CheckboxGroup
        name="permissions"
        legend={content.permissions.legend}
        error={errors.permissions}
        firstRef={permissionsRef}
        options={PERMISSIONS.map((permission) => ({
          value: permission,
          label: usersEn.permissions[permission],
          description: adminEn.permissionDescriptions[permission],
        }))}
        value={values.permissions}
        onChange={(next) => change({ ...values, permissions: next as Permission[] })}
        className="mt-6"
      />
      {notice}

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {/* Leaves at once without changes; with changes, asks first */}
        <Button
          variant="secondary"
          to={content.back.href}
          onClick={(event) => {
            if (!changed) return
            event.preventDefault()
            // Focus comes back here on Keep editing.
            cancelRef.current = event.currentTarget
            setConfirmingCancel(true)
          }}
        >
          {content.cancel}
        </Button>
        <Button type="submit" aria-disabled={busy || undefined}>
          {busy && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />}
          {busy && busyLabel ? busyLabel : submitLabel}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingCancel}
        title={content.unsavedChanges.title}
        description={content.unsavedChanges.description}
        cancelLabel={content.unsavedChanges.keep}
        confirmLabel={content.unsavedChanges.discard}
        onConfirm={() => navigate(content.back.href)}
        onCancel={() => {
          setConfirmingCancel(false)
          cancelRef.current?.focus()
        }}
      />
    </form>
  )
}
