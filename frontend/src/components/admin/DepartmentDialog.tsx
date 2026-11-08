import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { FormDialog } from '../ui/FormDialog'
import { SelectField } from '../ui/SelectField'
import { TextAreaField } from '../ui/TextAreaField'
import { TextField } from '../ui/TextField'
import { adminEn } from '../../content/admin.en'
import { organizationAdminEn as orgText } from '../../content/organizationAdmin.en'
import {
  departmentFormProblems,
  divisionIsOptional,
  formInitials,
  initialDivisionId,
  submitDepartmentForm,
  type DepartmentFormField,
  type DepartmentFormProblem,
  type DepartmentFormValues,
} from '../../lib/departmentForm'
import { saveDepartment, type ManagedDepartment, type ManagementSnapshot } from '../../services/organizationAdmin'
import { useDepartments } from '../../state/departmentsContext'

/** The dialog's field order, for moving focus to the first problem. */
const FIELD_ORDER: DepartmentFormField[] = ['name', 'divisionId', 'email', 'description']

type FieldErrors = Partial<Record<DepartmentFormField, string>>

/**
 * Add Department (with `divisionId`, the division whose "Add Department" was used) and Edit Department
 * (with `department`) in the same dialog as DivisionForm. Same rules as the Add/Edit Department page
 * (lib/departmentForm.ts); initials are generated from the name. A legacy department without a division
 * may stay unassigned; a new one needs a division. On success the dialog closes and `onSaved` reports it.
 */
export function DepartmentForm({ snapshot, department, divisionId, onClose, onSaved }: {
  snapshot: ManagementSnapshot; department?: ManagedDepartment; divisionId?: string
  onClose: () => void; onSaved?: (notice: 'added' | 'updated') => void
}) {
  const content = adminEn.departmentForm
  const { reload } = useDepartments()
  // Decided once: a snapshot refresh while the dialog is open doesn't change what is being edited.
  const [divisionOptional] = useState(() => divisionIsOptional(department))
  const [expectedUpdatedAt] = useState(department?.updated_at)
  const [values, setValues] = useState<DepartmentFormValues>(() => ({
    name: department?.name ?? '',
    divisionId: initialDivisionId(snapshot, department, divisionId),
    email: department?.email ?? '',
    description: department?.description ?? '',
  }))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const divisionRef = useRef<HTMLSelectElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)

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
    return Object.fromEntries(FIELD_ORDER.map((field) => [field, problems[field] && messages[problems[field]]]))
  }
  // Errors first show on Save; after that, each field re-checks when it loses focus.
  const blur = (field: DepartmentFormField) => { if (attempted) setErrors((previous) => ({ ...previous, [field]: errorsFor(values)[field] })) }
  const set = (field: DepartmentFormField) => (event: { target: { value: string } }) => setValues({ ...values, [field]: event.target.value })

  const divisionOptions = [
    ...(divisionOptional ? [{ value: '', label: orgText.noDivision }] : []),
    ...snapshot.divisions.map((division) => ({ value: division.id, label: division.name })),
  ]

  return <FormDialog open title={department ? content.edit.title : content.add.title}
    confirmLabel={department ? content.dialogSubmit.edit : content.dialogSubmit.add} cancelLabel={content.cancel}
    onClose={onClose} onConfirm={async () => {
      setAttempted(true)
      const next = errorsFor(values)
      // Render the messages before moving focus, so screen readers read them with the field.
      flushSync(() => { setErrors(next); setError('') })
      const firstInvalid = FIELD_ORDER.find((field) => next[field])
      if (firstInvalid) {
        const refs = { name: nameRef, divisionId: divisionRef, email: emailRef, description: descriptionRef }
        refs[firstInvalid].current?.focus()
        return false
      }
      try {
        const { state } = await submitDepartmentForm(values, formInitials(values, snapshot, department), department, expectedUpdatedAt, { save: saveDepartment, reload })
        onSaved?.(state.notice)
      } catch (reason) { setError((reason as Error).message); return false }
    }}>
    <TextField ref={nameRef} name="departmentName" autoComplete="off" label={content.name.label} required requiredMark
      value={values.name} error={errors.name} onChange={set('name')} onBlur={() => blur('name')} />
    <SelectField ref={divisionRef} name="departmentDivision" label={orgText.division}
      required={!divisionOptional} requiredMark={!divisionOptional} placeholder={divisionOptional ? undefined : orgText.selectDivision}
      options={divisionOptions} value={values.divisionId} error={errors.divisionId} onChange={set('divisionId')} onBlur={() => blur('divisionId')} />
    <TextField ref={emailRef} name="departmentEmail" type="email" autoComplete="off" label={content.email.label} placeholder={content.email.placeholder}
      value={values.email} error={errors.email} onChange={set('email')} onBlur={() => blur('email')} />
    <TextAreaField ref={descriptionRef} name="departmentDescription" rows={3} label={content.description.label} hint={content.description.hint}
      value={values.description} error={errors.description} onChange={set('description')} onBlur={() => blur('description')} />
    {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
  </FormDialog>
}
