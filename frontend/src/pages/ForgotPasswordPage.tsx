import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { LoaderCircle } from 'lucide-react'
import { MessageScreen } from '../components/layout/MessageScreen'
import { PageBackLink } from '../components/layout/PageBackLink'
import { Button } from '../components/ui/Button'
import { TextField } from '../components/ui/TextField'
import { FORM_CARD } from '../components/ui/formCard'
import { forgotPasswordEn } from '../content/auth.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { forgotEmailProblem } from '../lib/forgotPassword'
import { sendPasswordResetEmail, type PasswordEmailFailureReason } from '../services/auth'

const content = forgotPasswordEn

/**
 * "/forgot-password": sends the Supabase password reset email; its link opens Set New Password.
 * The confirmation is the same whether or not the address has an account, so the page doesn't
 * reveal who uses Hawkim.
 */
export function ForgotPasswordPage() {
  useDocumentTitle(content.pageTitle)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()
  const [failure, setFailure] = useState('')
  const [sending, setSending] = useState(false)
  const [sentTo, setSentTo] = useState('')
  const emailRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => emailRef.current?.focus(), [])
  // The page's content was replaced: move focus to the new heading.
  useEffect(() => {
    if (sentTo) titleRef.current?.focus()
  }, [sentTo])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    setFailure('')
    const problem = forgotEmailProblem(email)
    if (problem) {
      // Render the message before moving focus, so screen readers announce it with the field.
      flushSync(() => setError(problem))
      emailRef.current?.focus()
      return
    }
    setSending(true)
    const address = email.trim()
    const result = await sendPasswordResetEmail(address)
    setSending(false)
    if (result.ok) {
      setSentTo(address)
      return
    }
    const messages: Record<PasswordEmailFailureReason, string> = {
      'too-many-attempts': content.errors.tooManyAttempts,
      'not-connected': content.errors.notConnected,
      failed: content.errors.failed,
    }
    setFailure(messages[result.reason])
  }

  if (sentTo) {
    return (
      <MessageScreen titleRef={titleRef} title={content.sent.title} text={content.sent.text.replace('{email}', sentTo)} logoAlt={content.logoAlt}>
        <Button to={content.backLink.href} size="lg">{content.backLink.label}</Button>
      </MessageScreen>
    )
  }

  return (
    <div className="relative">
      <PageBackLink to={content.backLink.href} label={content.backLink.label} />
      <MessageScreen title={content.title} text={content.text} logoAlt={content.logoAlt}>
      <form noValidate onSubmit={submit} className={`${FORM_CARD} w-[min(26rem,calc(100vw-2rem))] space-y-5 text-left`}>
        {failure && <p role="alert" className="text-sm text-status-rejected-fg">{failure}</p>}
        <TextField
          ref={emailRef}
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          requiredMark
          label={content.emailLabel}
          value={email}
          error={error}
          onChange={(event) => { setEmail(event.target.value); setError(undefined) }}
        />
        <Button type="submit" className="w-full" aria-disabled={sending || undefined}>
          {sending && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />}
          {content.submit}
        </Button>
        <Button to={content.backLink.href} variant="secondary" className="w-full">{content.backLink.label}</Button>
      </form>
      </MessageScreen>
    </div>
  )
}
