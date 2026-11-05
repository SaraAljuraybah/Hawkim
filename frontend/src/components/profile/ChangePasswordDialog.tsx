import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { KeyRound } from 'lucide-react'
import { FormDialog } from '../ui/FormDialog'
import { PasswordField } from '../ui/PasswordField'
import type { ProfileContent } from '../../content/types'
import { changePasswordProblems, PASSWORD_CHANGE_ACTIVE, PASSWORD_MIN_LENGTH } from '../../lib/newPassword'

type Field = 'current' | 'next' | 'confirm'
type Errors = Partial<Record<Field, string>>

const EMPTY: Record<Field, string> = { current: '', next: '', confirm: '' }

/**
 * Change Password from My Profile: current, new and confirmation fields, checked on Save.
 * Not connected yet (PASSWORD_CHANGE_ACTIVE): a valid Save only says so. The typed passwords
 * stay in this component's state and are cleared whenever the dialog closes.
 */
export function ChangePasswordDialog({ open, content, onClose }: { open: boolean; content: ProfileContent['password']['dialog']; onClose: () => void }) {
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [notice, setNotice] = useState('')
  const currentRef = useRef<HTMLInputElement>(null)
  const nextRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const refs = { current: currentRef, next: nextRef, confirm: confirmRef }
  const min = String(PASSWORD_MIN_LENGTH)

  function change(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setNotice('')
  }

  function save() {
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
        setNotice('')
      })
      refs[invalid].current?.focus()
      return false
    }
    if (!PASSWORD_CHANGE_ACTIVE) {
      setNotice(content.notConnected)
      return false
    }
    // Connecting the change goes here.
    return false
  }

  function close() {
    setValues(EMPTY)
    setErrors({})
    setNotice('')
    onClose()
  }

  const eye = { showLabel: content.show, hideLabel: content.hide, lockIcon: true, required: true }
  return (
    <FormDialog
      open={open}
      icon={<KeyRound className="size-6" strokeWidth={1.75} />}
      title={content.title}
      description={content.text}
      confirmLabel={content.save}
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
      {/* Stays mounted while the dialog is open, so the message is announced */}
      <div role="status" className="empty:-mt-5">
        {notice && <p className="rounded-lg border border-status-pending-fg/25 bg-status-pending-bg px-3.5 py-2.5 text-sm font-medium text-status-pending-fg">{notice}</p>}
      </div>
    </FormDialog>
  )
}
