import { lazy, Suspense, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, CircleCheck, Download, FileText, MessageSquareWarning } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { StatusBadge } from '../components/ui/StatusBadge'
import { CommentItems, CommentList } from '../components/workflow/CommentList'
import { FileDialog } from '../components/workflow/FileDialog'
import { ResubmitDialog } from '../components/workflow/ResubmitDialog'
import { StatusTracker } from '../components/workflow/StatusTracker'
import { SubmitDialog } from '../components/workflow/SubmitDialog'
import { WorkflowTimeline } from '../components/workflow/WorkflowTimeline'
import { sopWorkflowEn } from '../content/workflow.en'
import { currentUser } from '../data/mock/currentUser'
import { getDepartmentName } from '../data/mock/departments'
import { getUser } from '../data/mock/users'
import type { Sop } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatDate, formatDateTime } from '../lib/format'
import { hasPermission } from '../lib/permissions'
import { sopPath } from '../lib/routes'
import { canResubmit, isApprover, latestReturn, latestReturnComments, nextVersion, pendingPeople, type UploadedFile } from '../lib/workflow'
import { useSops } from '../state/sopsContext'
import { NotFoundPage } from './NotFoundPage'

type DialogName = 'submit' | 'replace' | 'newVersion' | 'resubmit'

/*
 * Development-only demo controls (simulated reviewer and approver actions).
 * In a production build import.meta.env.DEV is false, so this becomes `null` and
 * the panel (with its text) is left out of the bundle entirely.
 */
const DemoPanel = import.meta.env.DEV ? lazy(() => import('../components/workflow/DemoPanel')) : null

/** Download name for the current file, e.g. "SOP-083_v1.1.pdf". */
function downloadName(sop: Sop) {
  return `${sop.code}_v${sop.version}.${sop.fileType}`
}

/** Keeps the uploaded file in memory (object URL) so it can be downloaded in this session. */
function toUploadedFile(file: File): UploadedFile {
  // TODO: Upload the file to the backend instead of keeping it in browser memory.
  return {
    fileName: file.name,
    fileType: file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx',
    fileUrl: URL.createObjectURL(file),
  }
}

/** A titled card section of the workflow page. */
function Section({ id, title, children, className = '' }: { id: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`rounded-xl border border-beige bg-white p-5 sm:p-6 ${className}`}>
      <h2 id={id} className="mb-4 text-lg">
        {title}
      </h2>
      {children}
    </section>
  )
}

/**
 * SOP workflow page ("/my-sops/:id"): the author's view of one SOP — status
 * tracker, current file, the actions allowed in this status, comments and the
 * review timeline (PBI 6, 8, 12, 22, 24). Only the SOP's author can open it.
 */
export function SopWorkflowPage() {
  const content = sopWorkflowEn
  const { id } = useParams()
  const store = useSops()
  // TODO: Use the authenticated user once real authentication exists.
  const user = currentUser
  const sop = store.sops.find((item) => item.id === id)
  const allowed = !!sop && hasPermission(user, 'author') && sop.authorId === user.id
  useDocumentTitle(allowed ? content.pageTitle.replace('{code}', sop.code) : undefined)

  const [dialog, setDialog] = useState<DialogName | null>(null)
  const [message, setMessage] = useState('')
  const triggerRef = useRef<HTMLElement | null>(null)
  const statusRef = useRef<HTMLDivElement>(null)

  if (!allowed) return <NotFoundPage embedded />

  const departmentName = getDepartmentName(sop.departmentId)
  const { dialogs, actions } = content

  function open(name: DialogName, trigger: HTMLElement) {
    triggerRef.current = trigger
    setMessage('')
    setDialog(name)
  }

  /**
   * Focus goes back to the button that opened the dialog. If that button is gone
   * (e.g. Submit for review after submitting), it goes to the status message area.
   */
  function closeDialog() {
    setDialog(null)
    requestAnimationFrame(() => {
      const trigger = triggerRef.current
      if (trigger?.isConnected) trigger.focus()
      else statusRef.current?.focus()
    })
  }

  function announce(text: string) {
    setMessage('')
    // Set a moment later so screen readers announce it even if the text repeats.
    window.setTimeout(() => setMessage(text), 50)
    // If the button that was used disappeared (the status changed), keep focus on the page.
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) statusRef.current?.focus()
    })
  }

  // Everyone still to decide in the current stage, e.g. "Faisal Alharbi (Reviewer)".
  const waitingFor = pendingPeople(sop)
    .map((person) => `${getUser(person.userId)?.name ?? ''} (${person.role === 'reviewer' ? content.roles.reviewer : content.roles.approver})`)
    .join(', ')
  const returned = sop.status === 'returned' ? latestReturn(sop) : undefined
  const feedback = sop.status === 'returned' ? latestReturnComments(sop) : []
  const resubmitReady = canResubmit(sop)

  return (
    <>
      <Link
        to={content.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {content.back.label}
      </Link>

      {/* Header */}
      <div className="mt-5">
        <p className="text-sm font-semibold text-maroon">{sop.code}</p>
        <h1 className="mt-1 text-2xl leading-tight tracking-tight sm:text-3xl">{sop.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-text-gray">
          <StatusBadge status={sop.status} />
          <span>{content.versionTemplate.replace('{version}', sop.version)}</span>
          <span aria-hidden="true">·</span>
          <span>
            <span className="sr-only">{content.departmentLabel}: </span>
            {departmentName}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {content.lastUpdatedTemplate.split('{date}')[0]}
            <time dateTime={sop.lastUpdated}>{formatDate(sop.lastUpdated)}</time>
            {content.lastUpdatedTemplate.split('{date}')[1]}
          </span>
        </div>
      </div>

      {/* Success message after an action (live region stays mounted) */}
      <div role="status" ref={statusRef} tabIndex={-1} className="rounded-lg focus:outline-none">
        {message && (
          <p className="mt-6 flex items-center gap-2.5 rounded-lg border border-status-approved-fg/20 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {message}
          </p>
        )}
      </div>

      {/* Feedback from the most recent return (PBI 8 / 12) */}
      {returned && (
        <section
          aria-labelledby="feedback-title"
          className="mt-6 rounded-xl border border-status-rejected-fg/25 bg-status-rejected-bg/50 p-5 sm:p-6"
        >
          <h2 id="feedback-title" className="flex items-center gap-2 text-lg">
            <MessageSquareWarning aria-hidden="true" className="size-5 text-status-rejected-fg" strokeWidth={1.75} />
            {content.feedback.title}
          </h2>
          <p className="mt-1 mb-4 text-sm text-maroon">
            {content.feedback.description
              .replace('{name}', getUser(returned.actorId)?.name ?? '')
              .replace('{role}', isApprover(sop, returned.actorId) ? content.roles.approver : content.roles.reviewer)
              .replace('{date}', formatDateTime(returned.createdAt))
              .replace('{version}', returned.version)}
          </p>
          <CommentItems sop={sop} comments={feedback} content={content} />
        </section>
      )}

      <Section id="tracker-title" title={content.tracker.label} className="mt-6">
        <StatusTracker sop={sop} content={content.tracker} />
      </Section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Current file */}
        <Section id="file-title" title={content.file.title}>
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-maroon/[0.07] text-maroon">
              <FileText className="size-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium break-all text-maroon">{sop.fileName}</p>
              <p className="mt-0.5 text-sm text-text-gray">
                {content.file.types[sop.fileType]} · {content.versionTemplate.replace('{version}', sop.version)}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {/* Sample SOPs without a real file show the name only (TODO: files from the backend). */}
            {sop.fileUrl && (
              <Button href={sop.fileUrl} download={downloadName(sop)} size="sm" variant="secondary">
                <Download aria-hidden="true" className="size-4" strokeWidth={2} />
                {content.file.download}
              </Button>
            )}
            {sop.status === 'published' && (
              <Button to={sopPath(sop.id)} size="sm" variant="secondary">
                {content.file.viewInDirectory}
                <ArrowUpRight aria-hidden="true" className="size-4" strokeWidth={2} />
              </Button>
            )}
          </div>
        </Section>

        {/* Actions allowed in this status */}
        <Section id="actions-title" title={actions.title}>
          {sop.status === 'draft' && (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button onClick={(event) => open('submit', event.currentTarget)}>{actions.submit}</Button>
              <Button variant="secondary" onClick={(event) => open('replace', event.currentTarget)}>
                {actions.replace}
              </Button>
            </div>
          )}

          {sop.status === 'returned' && (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button onClick={(event) => open('newVersion', event.currentTarget)}>{actions.uploadNewVersion}</Button>
                <Button
                  variant="secondary"
                  disabled={!resubmitReady}
                  aria-describedby={resubmitReady ? undefined : 'resubmit-hint'}
                  onClick={(event) => open('resubmit', event.currentTarget)}
                >
                  {actions.resubmit}
                </Button>
              </div>
              {!resubmitReady && (
                <p id="resubmit-hint" className="text-sm text-text-gray">
                  {actions.resubmitHint}
                </p>
              )}
            </div>
          )}

          {(sop.status === 'in-review' || sop.status === 'in-approval') && (
            <p className="text-sm text-text-gray">{actions.waiting.replace('{name} ({role})', waitingFor)}</p>
          )}
          {sop.status === 'approved' && <p className="text-sm text-text-gray">{actions.approvedWaiting}</p>}
          {sop.status === 'published' && <p className="text-sm text-text-gray">{actions.published}</p>}
        </Section>
      </div>

      <Section id="comments-title" title={content.comments.title} className="mt-6">
        <CommentList sop={sop} content={content} />
      </Section>

      <Section id="timeline-title" title={content.timeline.title} className="mt-6">
        <WorkflowTimeline sop={sop} content={content} />
      </Section>

      {DemoPanel && (
        <Suspense fallback={null}>
          <DemoPanel sop={sop} announce={announce} />
        </Suspense>
      )}

      {/* Dialogs */}
      {dialog === 'submit' && (
        <SubmitDialog
          content={dialogs}
          authorId={user.id}
          onClose={closeDialog}
          onSubmit={(reviewerId, approverId, note) => {
            // Temporary until the dialog supports several people and due days (next commit).
            store.submitForReview(sop.id, {
              reviewerIds: [reviewerId],
              approverIds: [approverId],
              reviewDueDays: 5,
              approvalDueDays: 5,
              note,
            })
            announce(content.messages.submitted)
          }}
        />
      )}
      {dialog === 'replace' && (
        <FileDialog
          content={dialogs}
          title={dialogs.replace.title}
          description={dialogs.replace.description.replace('{version}', sop.version)}
          confirmLabel={dialogs.replace.confirm}
          onClose={closeDialog}
          onSubmit={(file) => {
            store.replaceFile(sop.id, toUploadedFile(file))
            announce(content.messages.replaced)
          }}
        />
      )}
      {dialog === 'newVersion' && (
        <FileDialog
          content={dialogs}
          title={dialogs.newVersion.title}
          description={dialogs.newVersion.description.replace('{version}', nextVersion(sop.version))}
          confirmLabel={dialogs.newVersion.confirm}
          onClose={closeDialog}
          onSubmit={(file) => {
            store.uploadNewVersion(sop.id, toUploadedFile(file))
            announce(content.messages.newVersion.replace('{version}', nextVersion(sop.version)))
          }}
        />
      )}
      {dialog === 'resubmit' && (
        <ResubmitDialog
          sop={sop}
          content={dialogs}
          onClose={closeDialog}
          onSubmit={() => {
            store.resubmit(sop.id)
            announce(content.messages.resubmitted)
          }}
        />
      )}
    </>
  )
}
