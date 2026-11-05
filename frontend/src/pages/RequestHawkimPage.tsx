import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { LoaderCircle } from 'lucide-react'
import { MessageScreen } from '../components/layout/MessageScreen'
import { Button } from '../components/ui/Button'
import { TextAreaField } from '../components/ui/TextAreaField'
import { TextField } from '../components/ui/TextField'
import { requestHawkimEn } from '../content/accessRequest.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { requestProblems, type RequestField, type RequestValues } from '../lib/accessRequest'
import { submitAccessRequest, type SubmitFailure } from '../services/accessRequests'

const content = requestHawkimEn
const FIELDS: RequestField[] = ['organization', 'contactName', 'jobTitle', 'email', 'phone', 'approxUsers', 'message']
const EMPTY: RequestValues = { organization: '', contactName: '', jobTitle: '', email: '', phone: '', approxUsers: '', message: '' }

/**
 * "/request-hawkim": the public Request Hawkim form. The access-requests Edge Function stores the
 * request, emails the Hawkim team a review link and sends the requester a confirmation.
 */
export function RequestHawkimPage() {
  useDocumentTitle(content.pageTitle)
  const [values, setValues] = useState<RequestValues>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<RequestField, string>>>({})
  const [failure, setFailure] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const website = useRef<HTMLInputElement>(null)
  const refs = useRef<Partial<Record<RequestField, HTMLInputElement | HTMLTextAreaElement | null>>>({})
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => refs.current.organization?.focus(), [])
  useEffect(() => {
    if (sent) titleRef.current?.focus()
  }, [sent])

  const set = (field: RequestField) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    setFailure('')
    const problems = requestProblems(values)
    const first = FIELDS.find((field) => problems[field])
    if (first) {
      // Render the messages before moving focus, so screen readers announce the first one.
      flushSync(() => setErrors(Object.fromEntries(FIELDS.map((field) => [field, problems[field] && content.errors[problems[field]]]))))
      refs.current[first]?.focus()
      return
    }
    setSending(true)
    const result = await submitAccessRequest(values, website.current?.value ?? '')
    setSending(false)
    if (result.ok) {
      setSent(true)
      return
    }
    const messages: Record<SubmitFailure, string> = {
      invalid: content.errors.failed,
      'too-many-requests': content.errors.tooManyRequests,
      'not-connected': content.errors.notConnected,
      failed: content.errors.failed,
    }
    setFailure(messages[result.reason])
  }

  if (sent) {
    const text = content.sent.text.replace('{name}', values.contactName.trim()).replace('{email}', values.email.trim())
    return (
      <MessageScreen titleRef={titleRef} title={content.sent.title} text={text} logoAlt={content.logoAlt}>
        <Button to={content.sent.action.href} size="lg">{content.sent.action.label}</Button>
      </MessageScreen>
    )
  }

  const field = (name: Exclude<RequestField, 'message'>, props: Record<string, unknown> = {}) => (
    <TextField
      ref={(element: HTMLInputElement | null) => { refs.current[name] = element }}
      name={name}
      label={content.fields[name]}
      required
      value={values[name]}
      error={errors[name]}
      onChange={set(name)}
      {...props}
    />
  )

  return (
    <MessageScreen title={content.title} text={content.text} logoAlt={content.logoAlt}>
      <form noValidate onSubmit={submit} className="w-[min(28rem,calc(100vw-2rem))] space-y-5 text-left">
        {failure && <p role="alert" className="text-sm text-status-rejected-fg">{failure}</p>}
        {field('organization', { autoComplete: 'organization', maxLength: 200 })}
        {field('contactName', { autoComplete: 'name', maxLength: 100 })}
        {field('jobTitle', { autoComplete: 'organization-title', maxLength: 100 })}
        {field('email', { type: 'email', autoComplete: 'email', autoCapitalize: 'none', spellCheck: false })}
        {field('phone', { type: 'tel', autoComplete: 'tel', hint: content.fields.phoneHint })}
        {field('approxUsers', { type: 'number', inputMode: 'numeric', min: 1, max: 100000 })}
        <TextAreaField
          ref={(element: HTMLTextAreaElement | null) => { refs.current.message = element }}
          name="message"
          label={content.fields.message}
          hint={content.fields.messageHint}
          rows={4}
          maxLength={2000}
          value={values.message}
          error={errors.message}
          onChange={set('message')}
        />
        {/* Hidden from people (and screen readers); bots tend to fill it in. */}
        <input ref={website} name="website" type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" defaultValue="" />
        <Button type="submit" className="w-full" aria-disabled={sending || undefined}>
          {sending && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />}
          {content.submit}
        </Button>
        <Button to={content.backLink.href} variant="secondary" className="w-full">{content.backLink.label}</Button>
      </form>
    </MessageScreen>
  )
}
