import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { LoaderCircle } from 'lucide-react'
import { adminEn } from '../../content/admin.en'
import type { UserFormText } from '../../content/types'
import { usersEn } from '../../content/users.en'
import type { Permission, User } from '../../data/mock/types'
import {
  defaultDivision,
  departmentsInDivision,
  hasUnsavedChanges,
  isSystemAdmin,
  POSITION_MAX,
  STAFF_PERMISSIONS,
  validateNewUser,
  type NewUser,
  type NewUserField,
  type NewUserProblem,
} from '../../lib/userAdmin'
import { useDepartments } from '../../state/departmentsContext'
import { Button } from '../ui/Button'
import { CheckboxGroup } from '../ui/CheckboxGroup'
import { PhoneField } from '../ui/PhoneField'
import { SelectCombobox } from '../ui/SelectCombobox'
import { TextField } from '../ui/TextField'
import { UnsavedChangesGuard, type UnsavedChangesText } from '../ui/UnsavedChangesGuard'
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
  /**
   * Asks before leaving with unsaved changes (see UnsavedChangesGuard). The parent starts a new form
   * (a new key) after saving, so saved values are never asked about.
   */
  unsavedChanges?: UnsavedChangesText
  /** The labels, hints and messages of name, email and phone, and where Cancel goes. Default: Staff's. */
  text?: UserFormText
  /** The permissions offered; none hides the choice (Admins: always the Admin permission). Default: Staff's. */
  permissionOptions?: Permission[]
}

/**
 * The form of Add/Edit Staff and Add/Edit Admin: full name, email (valid and unique) and phone number
 * (+9665XXXXXXXX: the 8 digits typed after a fixed "+9665") are required; staff also need a division,
 * a department (one of that division's) and a position. An administrator (the Admin permission, set by
 * the Admins pages, which offer no permissions) has none of those, so they are hidden. Staff permissions
 * are optional. Division comes first: the department list waits for it, and when "No Division" is the
 * only choice it is chosen from the start.
 */
export function UserForm({ initial, otherUsers, submitLabel, busyLabel, notice, onEdit, onSubmit, unsavedChanges, text, permissionOptions = STAFF_PERMISSIONS }: UserFormProps) {
  const content = adminEn.addUser
  const fieldText = text ?? content
  const { activeDepartments } = useDepartments()

  const [values, setValues] = useState<NewUser>(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const divisionRef = useRef<HTMLInputElement>(null)
  const departmentRef = useRef<HTMLInputElement>(null)
  const positionRef = useRef<HTMLInputElement>(null)
  const permissionsRef = useRef<HTMLInputElement>(null)

  const division = values.divisionId ?? defaultDivision(activeDepartments)
  const user: NewUser = { ...values, divisionId: division }
  const systemAdmin = isSystemAdmin(values)
  // The phone is compared as stored ("+9665" and the digits), so an untouched number is no change.
  const dirty = hasUnsavedChanges({ ...initial, divisionId: initial.divisionId ?? defaultDivision(activeDepartments) }, user)
  const departmentOptions = departmentsInDivision(activeDepartments, division).map((department) => ({ value: department.id, label: department.name }))

  const messages: Record<NewUserProblem, string> = {
    'name-required': fieldText.errors.nameRequired,
    'email-invalid': fieldText.errors.emailInvalid,
    'email-taken': fieldText.errors.emailTaken,
    'phone-required': fieldText.errors.phoneRequired,
    'phone-invalid': fieldText.errors.phoneInvalid,
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
        label={fieldText.name.label}
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
        label={fieldText.email.label}
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
        label={fieldText.phone.label}
        required
        requiredMark
        hint={fieldText.phone.hint}
        invalidMessage={fieldText.errors.phoneInvalid}
        value={values.phone}
        error={errors.phone}
        onChange={(phone) => change({ ...values, phone })}
        onBlur={() => blur('phone')}
        className="mt-5"
      />
      {!systemAdmin && (<>
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
      </>)}
      {permissionOptions.length > 0 && <CheckboxGroup
        name="permissions"
        legend={content.permissions.legend}
        error={errors.permissions}
        firstRef={permissionsRef}
        options={permissionOptions.map((permission) => ({
          value: permission,
          label: usersEn.permissions[permission],
          description: adminEn.permissionDescriptions[permission],
        }))}
        value={values.permissions}
        onChange={(next) => change({ ...values, permissions: next as Permission[] })}
        className="mt-6"
      />}
      {notice}
      {unsavedChanges && <UnsavedChangesGuard when={dirty && !busy} text={unsavedChanges} />}

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" to={fieldText.back.href}>
          {fieldText.cancel}
        </Button>
        <Button type="submit" aria-disabled={busy || undefined}>
          {busy && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />}
          {busy && busyLabel ? busyLabel : submitLabel}
        </Button>
      </div>
    </form>
  )
}
