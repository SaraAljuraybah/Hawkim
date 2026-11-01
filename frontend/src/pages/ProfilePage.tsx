import { useState } from 'react'
import { CircleCheck, LoaderCircle } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { profileEn } from '../content/profile.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { sendPasswordResetEmail, type PasswordEmailFailureReason } from '../services/auth'
import { useActiveDepartment } from '../state/activeDepartmentContext'
import { useCurrentUser } from '../state/sessionContext'

/** My Profile ("/profile"): the signed-in employee's own information, read-only, and a password change by email link. */
export function ProfilePage() {
  const content = profileEn
  useDocumentTitle(content.pageTitle)
  const user = useCurrentUser()
  const { homeDepartment } = useActiveDepartment()
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [failure, setFailure] = useState('')
  const roles = user.permissions.flatMap((permission) => (permission === 'admin' ? [] : [content.roles[permission]]))
  const details = [
    [content.fields.name, user.name],
    [content.fields.email, user.email],
    [content.fields.department, homeDepartment.name],
    [content.fields.division, homeDepartment.divisionId || content.none],
    [content.fields.roles, roles.join(', ') || content.none],
  ]
  const failures: Record<PasswordEmailFailureReason, string> = {
    'too-many-attempts': content.password.errors.tooManyAttempts,
    'not-connected': content.password.errors.notConnected,
    failed: content.password.errors.failed,
  }

  async function changePassword() {
    if (sending) return
    setSending(true)
    setSent(false)
    setFailure('')
    const result = await sendPasswordResetEmail(user.email)
    setSending(false)
    if (result.ok) setSent(true)
    else setFailure(failures[result.reason])
  }

  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <Card title={content.detailsTitle} titleId="profile-details-title" className="mt-6 max-w-2xl">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          {details.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-text-gray">{label}</dt>
              <dd className="min-w-0 break-words text-maroon max-sm:mb-1">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title={content.password.title} titleId="profile-password-title" className="mt-6 max-w-2xl">
        <p className="text-sm text-text-gray">{content.password.text}</p>
        <Button size="sm" className="mt-4" aria-disabled={sending || undefined} onClick={changePassword}>
          {sending && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />}
          {content.password.change}
        </Button>
        {/* Live regions stay mounted, so the result is announced */}
        <div role="status">
          {sent && (
            <p className="mt-4 flex items-center gap-2.5 rounded-lg border border-status-approved-fg/20 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
              <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
              {content.password.sent}
            </p>
          )}
        </div>
        <div role="alert">{failure && <p className="mt-4 text-sm text-status-rejected-fg">{failure}</p>}</div>
      </Card>
    </>
  )
}
