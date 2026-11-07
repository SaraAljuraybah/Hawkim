import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { KeyRound } from 'lucide-react'
import { FormDialog } from '../ui/FormDialog'
import { PasswordField } from '../ui/PasswordField'
import type { ProfileContent } from '../../content/types'
import { changePasswordProblems, PASSWORD_MIN_LENGTH } from '../../lib/newPassword'
import { changePassword } from '../../services/auth'

type Field = 'current' | 'next' | 'confirm'
type Errors = Partial<Record<Field, string>>

const EMPTY: Record<Field, string> = { current: '', next: '', confirm: '' }

/**
 * Change Password from My Profile: current, new and confirmation fields, checked on Save. The new
 * password is only saved once Supabase Auth confirms the current one (services/auth.ts); otherwise
 * nothing changes and the dialog says why. The typed passwords stay in this component's state and
 * are cleared whenever the dialog closes.
 */
export function ChangePasswordDialog({ open, content, onClose, onChanged }: {
  open: boolean
  content: ProfileContent['password']['dialog']
  onClose: () => void
  /** The password was changed; the dialog closes next. */
  onChanged: () => void
}) {
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState('')
  const currentRef = useRef<HTMLInputElement>(null)
  const nextRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const failureRef = useRef<HTMLDivElement>(null)
  const refs = { current: currentRef, next: nextRef, confirm: confirmRef }
  const min = String(PASSWORD_MIN_LENGTH)

  function change(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFailure('')
  }

  /** A field's error: rendered before moving focus, so screen readers announce it with the field. */
  function showFieldError(field: Field, message: string) {
    flushSync(() => setErrors((current) => ({ ...current, [field]: message })))
    refs[field].current?.focus()
  }

  async function save() {
    const problems = changePasswordProblems(values.current, values.next, values.confirm)
    const next: Errors = {
      current: problems.current && content.errors.currentRequired,
      next:
        problems.password === 'required' ? content.errors.nextRequired
          : problems.password === 'too-short' ? content.errors.tooShort.replace('{min}', min)
            : problems.sameAsCurrent ? content.errors.sameAsCurrent
              : undefined,
      confirm: problems.confirm && content.errors[problems.confirm === 'required' ? 'confirmRequired' : 'mismatch'],
    }
    const invalid = (['current', 'next', 'confirm'] as const).find((field) => next[field])
    if (invalid) {
      // Render the messages before moving focus, so screen readers announce them with the field.
      flushSync(() => {
        setErrors(next)
        setFailure('')
      })
      refs[invalid].current?.focus()
      return false
    }
    setFailure('')
    const result = await changePassword(values.current, values.next)
    if (result.ok) {
      onChanged()
      return true
    }
    if (result.reason === 'wrong-current') showFieldError('current', content.errors.currentIncorrect)
    else if (result.reason === 'same-password') showFieldError('next', content.errors.sameAsCurrent)
    else if (result.reason === 'weak-password') showFieldError('next', content.errors.weak)
    else {
      const messages = {
        'too-many-attempts': content.errors.tooManyAttempts,
        'not-connected': content.errors.notConnected,
        expired: content.errors.sessionEnded,
        failed: content.errors.failed,
      }
      flushSync(() => setFailure(messages[result.reason as keyof typeof messages]))
      failureRef.current?.focus()
    }
    return false
  }

  function close() {
    setValues(EMPTY)
    setErrors({})
    setFailure('')
    onClose()
  }

  const eye = { showLabel: content.show, hideLabel: content.hide, required: true }
  return (
    <FormDialog
      open={open}
      icon={<KeyRound className="size-6" strokeWidth={1.75} />}
      title={content.title}
      confirmLabel={content.save}
      busyLabel={content.saving}
      lockWhileBusy
      cancelLabel={content.cancel}
      closeLabel={content.close}
      onConfirm={save}
      onClose={close}
    >
      <PasswordField ref={currentRef} {...eye} name="currentPassword" label={content.current} autoComplete="current-password"
        error={errors.current} value={values.current} onChange={(event) => change('current', event.target.value)} />
      <PasswordField ref={nextRef} {...eye} name="newPassword" label={content.next} autoComplete="new-password"
        hint={content.hint.replace('{min}', min)} error={errors.next} value={values.next} onChange={(event) => change('next', event.target.value)} />
      <PasswordField ref={confirmRef} {...eye} name="confirmPassword" label={content.confirm} autoComplete="new-password"
        error={errors.confirm} value={values.confirm} onChange={(event) => change('confirm', event.target.value)} />
      {/* Stays mounted while the dialog is open, so a failure is announced; it also adds space above the buttons */}
      <div ref={failureRef} role="alert" tabIndex={-1} className="rounded-lg focus:outline-none">
        {failure && <p className="rounded-lg border border-status-rejected-fg/25 bg-status-rejected-bg px-3.5 py-2.5 text-sm font-medium text-status-rejected-fg">{failure}</p>}
      </div>
    </FormDialog>
  )
}
