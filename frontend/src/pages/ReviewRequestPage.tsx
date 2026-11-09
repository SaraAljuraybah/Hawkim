import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { MessageScreen } from '../components/layout/MessageScreen'
import { Button } from '../components/ui/Button'
import { reviewRequestEn } from '../content/accessRequest.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { decideAccessRequest, viewAccessRequest, type AccessRequestView, type DecideFailure } from '../services/accessRequests'

const content = reviewRequestEn

type Stage =
  | { kind: 'loading' }
  | { kind: 'message'; title: string; text: string }
  | { kind: 'review'; request: AccessRequestView }

/**
 * "/review-request?id=…&token=…": the Hawkim team's review page, opened from the request email.
 * Accept creates the requester's account as Admin; Reject tells them by email. The link's token is
 * checked by the access-requests Edge Function; nothing is decided just by opening the page.
 */
export function ReviewRequestPage() {
  useDocumentTitle(content.pageTitle)
  const [params] = useSearchParams()
  const id = params.get('id') ?? ''
  const token = params.get('token') ?? ''
  const [stage, setStage] = useState<Stage>({ kind: 'loading' })
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null)
  const [failure, setFailure] = useState('')
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let active = true
    viewAccessRequest(id, token).then((result) => {
      if (!active) return
      if (!result.ok) {
        setStage(result.reason === 'not-found'
          ? { kind: 'message', ...content.notFound }
          : { kind: 'message', title: content.notFound.title, text: result.reason === 'not-connected' ? content.errors.notConnected : content.errors.failed })
        return
      }
      const request = result.request
      if (request.status !== 'pending') setStage({ kind: 'message', ...content.decided[request.status] })
      else if (request.expired) setStage({ kind: 'message', ...content.expired })
      else setStage({ kind: 'review', request })
    })
    return () => { active = false }
  }, [id, token])

  useEffect(() => {
    if (stage.kind === 'message') titleRef.current?.focus()
  }, [stage])

  async function decide(decision: 'accept' | 'reject', request: AccessRequestView) {
    if (busy) return
    setFailure('')
    setBusy(decision)
    const result = await decideAccessRequest(id, token, decision)
    setBusy(null)
    if (result.ok) {
      const done = decision === 'accept'
        ? { title: content.accepted.title, text: (result.emailSent ? content.accepted.text : content.accepted.emailFailed).replace('{email}', request.email) }
        : { title: content.rejected.title, text: content.rejected.text.replace('{email}', request.email) }
      setStage({ kind: 'message', ...done })
      return
    }
    const messages: Partial<Record<DecideFailure, string>> = {
      'email-in-use': content.errors.emailInUse,
      'deployment-onboarded': content.errors.deploymentOnboarded,
      'account-failed': content.errors.accountFailed,
      'not-connected': content.errors.notConnected,
    }
    if (result.reason === 'not-found') setStage({ kind: 'message', ...content.notFound })
    else if (result.reason === 'expired') setStage({ kind: 'message', ...content.expired })
    else if (result.reason === 'already-decided') setStage({ kind: 'message', title: content.alreadyDecided.title, text: content.alreadyDecided.text })
    else setFailure(messages[result.reason] ?? content.errors.failed)
  }

  if (stage.kind === 'loading') {
    return (
      <MessageScreen title={content.title} text={content.loading} logoAlt={content.logoAlt}>
        <LoaderCircle aria-hidden="true" className="size-6 text-text-gray motion-safe:animate-spin" strokeWidth={1.75} />
      </MessageScreen>
    )
  }
  if (stage.kind === 'message') {
    return <MessageScreen titleRef={titleRef} title={stage.title} text={stage.text} logoAlt={content.logoAlt} />
  }

  const { request } = stage
  const rows: [string, string][] = [
    [content.labels.organization, request.organization],
    [content.labels.contactName, request.contactName],
    [content.labels.jobTitle, request.jobTitle],
    [content.labels.email, request.email],
    [content.labels.phone, request.phone],
    [content.labels.approxUsers, String(request.approxUsers)],
    [content.labels.message, request.message || content.noMessage],
    [content.labels.received, new Date(request.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })],
  ]
  return (
    <MessageScreen title={content.title} text={content.text} logoAlt={content.logoAlt}>
      <div className="w-[min(30rem,calc(100vw-2rem))] space-y-5 text-left">
        <dl className="divide-y divide-beige rounded-lg border border-beige bg-white text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-3 px-4 py-2.5">
              <dt className="text-text-gray">{label}</dt>
              <dd className="font-medium whitespace-pre-line break-words text-maroon">{value}</dd>
            </div>
          ))}
        </dl>
        {request.accountExists && <p role="alert" className="text-sm text-status-rejected-fg">{content.accountExists}</p>}
        {failure && <p role="alert" className="text-sm text-status-rejected-fg">{failure}</p>}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button className="w-full" aria-disabled={busy !== null || request.accountExists || undefined} onClick={() => !request.accountExists && decide('accept', request)}>
            {busy === 'accept' && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />}
            {content.accept}
          </Button>
          <Button variant="secondary" className="w-full" aria-disabled={busy !== null || undefined} onClick={() => decide('reject', request)}>
            {busy === 'reject' && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />}
            {content.reject}
          </Button>
        </div>
      </div>
    </MessageScreen>
  )
}
