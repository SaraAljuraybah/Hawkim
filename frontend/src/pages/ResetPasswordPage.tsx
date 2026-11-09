import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { LoaderCircle } from 'lucide-react'
import { MessageScreen } from '../components/layout/MessageScreen'
import { Button } from '../components/ui/Button'
import { PageLoading } from '../components/ui/PageLoading'
import { PasswordField } from '../components/ui/PasswordField'
import { resetPasswordEn } from '../content/profile.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { newPasswordProblems, PASSWORD_MIN_LENGTH } from '../lib/newPassword'
import { profilePathFor } from '../lib/routes'
import { restoreSession, setNewPassword, startPasswordRecovery, type NewPasswordFailureReason } from '../services/auth'
import { useSession } from '../state/sessionContext'

const content = resetPasswordEn

/** The two password fields; `onSaved` runs once the new password is saved. */
export function NewPasswordForm({ onSaved, onExpired }: { onSaved: () => void | Promise<void>; onExpired: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const [failure, setFailure] = useState('')
  const [saving, setSaving] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  useEffect(() => passwordRef.current?.focus(), [])

  function showErrors(next: { password?: string; confirm?: string }) {
    // Render the messages before moving focus, so screen readers announce them with the field.
    flushSync(() => setErrors(next))
    if (next.password) passwordRef.current?.focus()
    else if (next.confirm) confirmRef.current?.focus()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setFailure('')
    const problems = newPasswordProblems(password, confirm)
    if (problems.password || problems.confirm) {
      showErrors({
        password: problems.password && content.errors[problems.password === 'required' ? 'passwordRequired' : 'passwordTooShort'].replace('{min}', String(PASSWORD_MIN_LENGTH)),
        confirm: problems.confirm && content.errors[problems.confirm === 'required' ? 'confirmRequired' : 'mismatch'],
      })
      return
    }
    setSaving(true)
    const result = await setNewPassword(password)
    if (result.ok) {
      await onSaved()
      return
    }
    setSaving(false)
    const messages: Record<Exclude<NewPasswordFailureReason, 'expired' | 'weak-password' | 'same-password'>, string> = {
      'too-many-attempts': content.errors.tooManyAttempts,
      'not-connected': content.errors.notConnected,
      failed: content.errors.failed,
    }
    if (result.reason === 'expired') onExpired()
    else if (result.reason === 'weak-password') showErrors({ password: content.errors.weakPassword })
    else if (result.reason === 'same-password') showErrors({ password: content.errors.samePassword })
    else setFailure(messages[result.reason])
  }

  const eye = { showLabel: content.showPassword, hideLabel: content.hidePassword }
  return (
    <form noValidate onSubmit={submit} className="w-[min(24rem,calc(100vw-2rem))] space-y-5 text-left">
      {failure && <p role="alert" className="text-sm text-status-rejected-fg">{failure}</p>}
      <PasswordField ref={passwordRef} {...eye} name="newPassword" label={content.passwordLabel} autoComplete="new-password" required
        hint={content.passwordHint.replace('{min}', String(PASSWORD_MIN_LENGTH))} error={errors.password} value={password}
        onChange={(event) => { setPassword(event.target.value); setErrors((current) => ({ ...current, password: undefined })) }} />
      <PasswordField ref={confirmRef} {...eye} name="confirmPassword" label={content.confirmLabel} autoComplete="new-password" required
        error={errors.confirm} value={confirm}
        onChange={(event) => { setConfirm(event.target.value); setErrors((current) => ({ ...current, confirm: undefined })) }} />
      <Button type="submit" className="w-full" aria-disabled={saving || undefined}>
        {saving && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />}
        {content.save}
      </Button>
    </form>
  )
}

type Stage = 'checking' | 'ready' | 'invalid' | 'saved' | 'saved-signed-out'

/**
 * Set New Password ("/reset-password"), opened from the recovery email. The Supabase client
 * doesn't read the address itself (see services/supabase.ts), so this page starts the recovery
 * session from the link, once, and removes the tokens from the address straight away.
 */
export function ResetPasswordPage() {
  useDocumentTitle(content.pageTitle)
  const session = useSession()
  const [stage, setStage] = useState<Stage>('checking')
  const titleRef = useRef<HTMLHeadingElement>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const { hash, pathname, search } = window.location
    window.history.replaceState(null, '', pathname + search)
    startPasswordRecovery(hash).then((ready) => setStage(ready ? 'ready' : 'invalid'))
  }, [])

  // The page's content was replaced: move focus to the new heading.
  useEffect(() => {
    if (stage === 'invalid' || stage === 'saved' || stage === 'saved-signed-out') titleRef.current?.focus()
  }, [stage])

  async function saved() {
    const user = await restoreSession()
    if (user) session.signIn(user)
    setStage(user ? 'saved' : 'saved-signed-out')
  }

  if (stage === 'checking') return <PageLoading fullScreen />
  if (stage === 'ready') {
    return (
      <MessageScreen title={content.title} text={content.text} logoAlt={content.logoAlt}>
        <NewPasswordForm onSaved={saved} onExpired={() => setStage('invalid')} />
      </MessageScreen>
    )
  }
  if (stage === 'invalid') {
    return (
      <MessageScreen titleRef={titleRef} title={content.invalid.title} text={content.invalid.text} logoAlt={content.logoAlt}>
        <Button to={profilePathFor(session.user)} size="lg">{content.invalid.action.label}</Button>
      </MessageScreen>
    )
  }
  const action = stage === 'saved' ? content.saved.dashboard : content.saved.signIn
  return (
    <MessageScreen titleRef={titleRef} title={content.saved.title} text={content.saved.text} logoAlt={content.logoAlt}>
      <Button to={action.href} size="lg">{action.label}</Button>
    </MessageScreen>
  )
}
