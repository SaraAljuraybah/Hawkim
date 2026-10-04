import { useId, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, CircleCheck, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { adminEn } from '../../content/admin.en'
import { requestsEn } from '../../content/requests.en'
import type { UserRequest } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { formatDate, formatDateTime } from '../../lib/format'
import { approveBlockers, rejectBlocker, type RequestBlocker } from '../../lib/requestAdmin'
import { adminUserPath } from '../../lib/routes'
import { useDepartments } from '../../state/departmentsContext'
import { useRequests } from '../../state/requestsContext'
import { useUsers } from '../../state/usersContext'
import { NotFoundPage } from '../NotFoundPage'

/**
 * A request's page in the admin portal ("/admin/requests/:id", PBI 33): who sent it,
 * what it asks for, and its status. A pending request can be approved or rejected
 * (each confirmed first); when an action can't be used, the reason is shown next to it.
 * Approving a Department Access request gives access at once; approving a Permission
 * or Role Change only marks it approved (the admin changes permissions on the user's page).
 */
export function RequestDetailsPage() {
  const { id } = useParams()
  const text = adminEn.requestDetails
  const { requests } = useRequests()
  const request = requests.find((item) => item.id === id)
  useDocumentTitle(request ? text.pageTitle.replace('{title}', request.title) : undefined)

  if (!request) return <NotFoundPage embedded />
  return (
    <>
      <Link
        to={text.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {text.back.label}
      </Link>
      {/* Another request starts fresh (no messages). */}
      <RequestPanels key={request.id} request={request} />
    </>
  )
}

/** A white card with an h2. */
function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-beige bg-white p-5 sm:p-6">
      <h2 id={id} className="text-lg">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Details({ items }: { items: { label: string; value: ReactNode; wide?: boolean }[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className={`min-w-0 ${item.wide ? 'sm:col-span-2' : ''}`}>
          <dt className="text-text-gray">{item.label}</dt>
          <dd className="mt-0.5 font-medium break-words whitespace-pre-line text-maroon">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function RequestPanels({ request }: { request: UserRequest }) {
  const text = adminEn.requestDetails
  const { approveRequest, rejectRequest } = useRequests()
  const { users, getUser, nameOf } = useUsers()
  const { departments, nameOf: departmentName } = useDepartments()

  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null)
  const [notice, setNotice] = useState('')
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const approveReasonId = useId()
  const rejectReasonId = useId()

  const requester = getUser(request.requesterId)
  const name = requester?.name ?? ''
  const isAccess = request.type === 'department-access'
  const department = departmentName(request.departmentId)

  /** Why an action can't be used, as sentences (undefined: it can be used). */
  function reason(blockers: (RequestBlocker | undefined)[]): string | undefined {
    const found = blockers.filter((blocker): blocker is RequestBlocker => !!blocker)
    return found.length > 0 ? found.map(sentence).join(' ') : undefined
  }
  function sentence(blocker: RequestBlocker): string {
    if (blocker === 'department-removed') return text.reasons.departmentRemoved.replace('{department}', department)
    if (blocker === 'requester-deleted') return text.reasons.requesterDeleted.replace('{name}', name)
    if (request.status === 'approved') return text.reasons.approved
    if (request.status === 'rejected') return text.reasons.rejected
    return text.reasons.cancelled.replace('{name}', name)
  }
  const approveReason = reason(approveBlockers(request, { users, departments }))
  const rejectReason = reason([rejectBlocker(request)])
  // Not pending: one reason covers both actions.
  const sameReason = approveReason === rejectReason

  function open(which: 'approve' | 'reject', trigger: HTMLElement) {
    triggerRef.current = trigger
    setDialog(which)
  }

  function confirm(which: 'approve' | 'reject') {
    setDialog(null)
    if (which === 'approve') approveRequest(request.id)
    else rejectRequest(request.id)
    // Say what happened, and move focus there (the buttons can no longer be used).
    flushSync(() => setNotice(which === 'approve' ? text.approvedNotice : text.rejectedNotice))
    noticeRef.current?.focus()
  }

  const submitted = request.submittedAt ? (
    <time dateTime={request.submittedAt}>{formatDateTime(request.submittedAt)}</time>
  ) : (
    <time dateTime={request.createdAt}>{formatDate(request.createdAt)}</time>
  )
  const decided =
    (request.status === 'approved' || request.status === 'rejected') && request.decidedById && request.decidedAt
      ? text.decided[request.status]
          .replace('{admin}', nameOf(request.decidedById))
          .replace('{date}', formatDateTime(request.decidedAt))
      : undefined

  const userLink = (label: string) =>
    requester && !requester.deletedAt ? (
      <Link
        to={adminUserPath(requester.id)}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-maroon underline underline-offset-2 hover:text-maroon-secondary"
      >
        {label.replace('{name}', name)}
        <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.75} />
      </Link>
    ) : null

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="min-w-0 text-2xl tracking-tight break-words sm:text-3xl">{request.title}</h1>
        <StatusBadge status={request.status} />
      </div>
      {decided && <p className="mt-2 text-sm text-text-gray">{decided}</p>}

      <div role="status">
        {notice && (
          <p
            ref={noticeRef}
            tabIndex={-1}
            className="mt-6 flex items-center gap-2 rounded-lg border border-status-approved-fg/25 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg focus:outline-none"
          >
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {notice}
          </p>
        )}
      </div>

      <div className="mt-6 grid max-w-3xl gap-6">
        <Panel id="request-title" title={text.request.title}>
          <Details
            items={[
              { label: text.request.type, value: requestsEn.types[request.type] },
              ...(isAccess ? [{ label: text.request.department, value: department }] : []),
              { label: text.request.submitted, value: submitted },
              { label: text.request.status, value: <StatusBadge status={request.status} /> },
              { label: text.request.requestTitle, value: request.title, wide: true },
              { label: text.request.description, value: request.description, wide: true },
            ]}
          />
        </Panel>

        <Panel id="requester-title" title={text.requester.title}>
          <Details
            items={[
              { label: text.requester.name, value: nameOf(request.requesterId) },
              { label: text.requester.email, value: <span className="break-all">{requester?.email}</span> },
              { label: text.requester.homeDepartment, value: departmentName(requester?.departmentId) },
            ]}
          />
          <div className="mt-4">{userLink(text.requester.userPage)}</div>
        </Panel>

        <Panel id="respond-title" title={text.respond.title}>
          <div className="flex flex-wrap gap-3">
            {/* aria-disabled keeps a blocked action focusable, so its reason can be heard */}
            <Button
              aria-disabled={approveReason ? true : undefined}
              aria-describedby={approveReason ? approveReasonId : undefined}
              onClick={(event) => !approveReason && open('approve', event.currentTarget)}
              // A blocked action looks inactive (gray), not like the main call to action.
              className="aria-disabled:border-text-gray/40 aria-disabled:bg-beige aria-disabled:text-text-gray aria-disabled:hover:border-text-gray/40 aria-disabled:hover:bg-beige"
            >
              <Check aria-hidden="true" className="size-4" strokeWidth={2} />
              {text.respond.approve}
            </Button>
            <Button
              variant="secondary"
              aria-disabled={rejectReason ? true : undefined}
              aria-describedby={rejectReason ? (sameReason ? approveReasonId : rejectReasonId) : undefined}
              onClick={(event) => !rejectReason && open('reject', event.currentTarget)}
              className="aria-disabled:border-text-gray/40 aria-disabled:text-text-gray aria-disabled:hover:bg-transparent"
            >
              <X aria-hidden="true" className="size-4" strokeWidth={2} />
              {text.respond.reject}
            </Button>
          </div>
          {approveReason && (
            <p id={approveReasonId} className="mt-3 text-sm text-text-gray">
              {approveReason}
            </p>
          )}
          {rejectReason && !sameReason && (
            <p id={rejectReasonId} className="mt-3 text-sm text-text-gray">
              {rejectReason}
            </p>
          )}
          {/* Permission and role changes are made on the user's page (linked under Requester). */}
          {!isAccess && requester && !requester.deletedAt && (
            <p className="mt-4 text-sm text-text-gray">{text.changeHint}</p>
          )}
        </Panel>
      </div>

      <ConfirmDialog
        open={dialog === 'approve'}
        title={text.approveDialog.title}
        description={(isAccess ? text.approveDialog.access : text.approveDialog.change)
          .replace('{name}', name)
          .replace('{department}', department)}
        cancelLabel={text.approveDialog.cancel}
        confirmLabel={text.approveDialog.confirm}
        onConfirm={() => confirm('approve')}
        onCancel={() => {
          setDialog(null)
          triggerRef.current?.focus()
        }}
      />
      <ConfirmDialog
        open={dialog === 'reject'}
        title={text.rejectDialog.title}
        description={
          requester && !requester.deletedAt
            ? text.rejectDialog.description.replace('{name}', name)
            : text.rejectDialog.deletedDescription
        }
        cancelLabel={text.rejectDialog.cancel}
        confirmLabel={text.rejectDialog.confirm}
        onConfirm={() => confirm('reject')}
        onCancel={() => {
          setDialog(null)
          triggerRef.current?.focus()
        }}
      />
    </>
  )
}
