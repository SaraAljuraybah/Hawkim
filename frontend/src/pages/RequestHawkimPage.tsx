import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { LoaderCircle } from 'lucide-react'
import { MessageScreen } from '../components/layout/MessageScreen'
import { PageBackLink } from '../components/layout/PageBackLink'
import { Button } from '../components/ui/Button'
import { EitherFieldGroup } from '../components/ui/EitherFieldGroup'
import { FieldGroup } from '../components/ui/FieldGroup'
import { PhoneField } from '../components/ui/PhoneField'
import { TextAreaField } from '../components/ui/TextAreaField'
import { TextField } from '../components/ui/TextField'
import { FORM_CARD } from '../components/ui/formCard'
import { requestHawkimEn } from '../content/accessRequest.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
  failureField,
  liveProblem,
  REQUEST_ERROR_ORDER,
  requestProblems,
  type RequestErrorKey,
  type RequestField,
  type RequestValues,
} from '../lib/accessRequest'
import { missingAddressAndMapsUrl, ORGANIZATION_DETAIL_MAX } from '../lib/organizationDetails'
import { submitAccessRequest, type SubmitFailure } from '../services/accessRequests'

const content = requestHawkimEn
/** Longest message (the database and the function allow 2000 characters). */
const MESSAGE_MAX = 2000
const EMPTY: RequestValues = {
  organization: '', contactName: '', email: '', phone: '',
  organizationEmail: '', organizationAddress: '', organizationMapsUrl: '', organizationWebsite: '', organizationDescription: '',
  approxUsers: '', message: '',
}
const IN_ADDRESS_GROUP: readonly RequestField[] = ['organizationAddress', 'organizationMapsUrl']

/**
 * "/request-hawkim": the public Request Hawkim form. The access-requests Edge Function stores the
 * request, emails the Hawkim team a review link and sends the requester a confirmation.
 */
export function RequestHawkimPage() {
  useDocumentTitle(content.pageTitle)
  const [values, setValues] = useState<RequestValues>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<RequestErrorKey, string>>>({})
  const [failure, setFailure] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const website = useRef<HTMLInputElement>(null)
  const refs = useRef<Partial<Record<RequestField, HTMLInputElement | HTMLTextAreaElement | null>>>({})
  const titleRef = useRef<HTMLHeadingElement>(null)

  // The form's first field.
  useEffect(() => refs.current.organization?.focus(), [])
  useEffect(() => {
    if (sent) titleRef.current?.focus()
  }, [sent])

  const messageFor = (field: RequestField, next: RequestValues) => {
    const problem = liveProblem(field, next)
    return problem && content.errors[problem]
  }
  // While a field's error shows, it's re-checked as they type: it clears once the value is valid (or empty:
  // "required" waits for Send Request). Otherwise typing shows nothing until they leave the field.
  // The Address group's error works the same way: re-checked while it shows, gone once one of the two is filled.
  const set = (field: RequestField) => (event: { target: { value: string } }) => {
    const next = { ...values, [field]: event.target.value }
    setValues(next)
    setErrors((current) => ({
      ...current,
      [field]: current[field] ? messageFor(field, next) : undefined,
      ...(IN_ADDRESS_GROUP.includes(field) && current.addressGroup && !missingAddressAndMapsUrl(next.organizationAddress, next.organizationMapsUrl)
        && { addressGroup: undefined }),
    }))
  }
  // Leaving a field with an invalid value shows its error (and the red field) at once. It never clears
  // one: an empty field keeps the "required" shown after Send Request.
  const check = (field: RequestField) => () => {
    const message = messageFor(field, values)
    if (message) setErrors((current) => ({ ...current, [field]: message }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    setFailure('')
    const problems = requestProblems(values)
    const first = REQUEST_ERROR_ORDER.find((key) => problems[key])
    if (first) {
      // Render the messages before moving focus, so screen readers announce the first one. The Address group's
      // "required" has its own message, and focus goes to its first box.
      flushSync(() => setErrors(Object.fromEntries(REQUEST_ERROR_ORDER.map((key) => [
        key, key === 'addressGroup' ? problems[key] && content.errors.addressGroup : problems[key] && content.errors[problems[key]],
      ]))))
      refs.current[first === 'addressGroup' ? 'organizationAddress' : first]?.focus()
      return
    }
    setSending(true)
    const result = await submitAccessRequest(values, website.current?.value ?? '')
    setSending(false)
    if (result.ok) {
      setSent(true)
      return
    }
    // Refused because of one field (the organization name is taken): its error, and focus there.
    const onField = failureField(result.reason)
    if (onField) {
      flushSync(() => setErrors((current) => ({ ...current, [onField.field]: content.errors[onField.error] })))
      refs.current[onField.field]?.focus()
      return
    }
    const messages: Record<SubmitFailure, string> = {
      invalid: content.errors.failed,
      'too-many-requests': content.errors.tooManyRequests,
      'organization-taken': content.errors.organizationTaken,
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

  // Required (with the red asterisk) unless `required: false` is passed: the website, and the two boxes of the
  // Address group (the asterisk is on the group's title).
  const field = (name: Exclude<RequestField, 'message' | 'organizationDescription'>, props: Record<string, unknown> = {}) => (
    <TextField
      ref={(element: HTMLInputElement | null) => { refs.current[name] = element }}
      name={name}
      label={content.fields[name]}
      required
      value={values[name]}
      error={errors[name]}
      onChange={set(name)}
      onBlur={check(name)}
      {...props}
    />
  )
  const linkProps = { type: 'url', inputMode: 'url', autoCapitalize: 'none', spellCheck: false, hint: content.fields.linkHint }

  return (
    <div className="relative">
      <PageBackLink to={content.backLink.href} label={content.backLink.label} />
      <MessageScreen title={content.title} text={content.text} logoAlt={content.logoAlt}>
      <form noValidate onSubmit={submit} className={`${FORM_CARD} w-[min(30rem,calc(100vw-2rem))] space-y-5 text-left`}>
        {failure && <p role="alert" className="text-sm text-status-rejected-fg">{failure}</p>}
        {/* The organization first, then its contact person, each in a bordered group like the Address one
            used to be. Address is a sub-group inside Organization, without a box of its own (no double border). */}
        <FieldGroup legend={content.groups.organization}>
          {field('organization', { autoComplete: 'organization', maxLength: 200 })}
          {/* The organization's details, with the Organization Profile's rules. */}
          {field('organizationEmail', {
            type: 'email', autoCapitalize: 'none', spellCheck: false, maxLength: ORGANIZATION_DETAIL_MAX.email,
            placeholder: content.fields.organizationEmailPlaceholder,
          })}
          <EitherFieldGroup legend={content.addressGroup.title} hint={content.addressGroup.hint} orLabel={content.addressGroup.or}
            requiredMark nested error={errors.addressGroup}
            first={(group) => field('organizationAddress', {
              ...group, required: false, autoComplete: 'street-address', maxLength: ORGANIZATION_DETAIL_MAX.address,
              placeholder: content.fields.organizationAddressPlaceholder,
            })}
            second={(group) => field('organizationMapsUrl', {
              ...group, ...linkProps, required: false, maxLength: ORGANIZATION_DETAIL_MAX.mapsUrl,
              placeholder: content.fields.organizationMapsUrlPlaceholder,
            })}
          />
          {field('organizationWebsite', {
            ...linkProps, required: false, autoComplete: 'url', maxLength: ORGANIZATION_DETAIL_MAX.website,
            placeholder: content.fields.organizationWebsitePlaceholder,
          })}
          <TextAreaField
            ref={(element: HTMLTextAreaElement | null) => { refs.current.organizationDescription = element }}
            name="organizationDescription"
            label={content.fields.organizationDescription}
            placeholder={content.fields.organizationDescriptionPlaceholder}
            required
            rows={4}
            maxLength={ORGANIZATION_DETAIL_MAX.description}
            resizable={false}
            counter={content.fields.organizationDescriptionCounter
              .replace('{count}', String(values.organizationDescription.length)).replace('{max}', String(ORGANIZATION_DETAIL_MAX.description))}
            value={values.organizationDescription}
            error={errors.organizationDescription}
            onChange={set('organizationDescription')}
            onBlur={check('organizationDescription')}
          />
          {field('approxUsers', { type: 'number', inputMode: 'numeric', min: 1, max: 100000 })}
        </FieldGroup>
        <FieldGroup legend={content.groups.contact}>
          {field('contactName', { autoComplete: 'name', maxLength: 100 })}
          {field('email', { type: 'email', autoComplete: 'email', autoCapitalize: 'none', spellCheck: false })}
          {/* "+9665" before the field and the 8 digits in it; values.phone keeps "+9665" and the digits */}
          <PhoneField
            ref={(element: HTMLInputElement | null) => { refs.current.phone = element }}
            name="phone"
            label={content.fields.phone}
            required
            requiredMark
            autoComplete="tel-national"
            hint={content.fields.phoneHint}
            invalidMessage={content.errors.phone}
            value={values.phone}
            error={errors.phone}
            onChange={(phone) => set('phone')({ target: { value: phone } })}
          />
        </FieldGroup>
        <TextAreaField
          ref={(element: HTMLTextAreaElement | null) => { refs.current.message = element }}
          name="message"
          label={content.fields.message}
          placeholder={content.fields.messagePlaceholder}
          rows={4}
          maxLength={MESSAGE_MAX}
          resizable={false}
          counter={content.fields.messageCounter.replace('{count}', String(values.message.length)).replace('{max}', String(MESSAGE_MAX))}
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
    </div>
  )
}
