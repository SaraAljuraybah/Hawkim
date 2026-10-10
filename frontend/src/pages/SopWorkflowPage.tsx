import { lazy, Suspense, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, CircleCheck, MessageSquareReply, ShieldCheck, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { StatusBadge } from '../components/ui/StatusBadge'
import { AddCoAuthorsDialog } from '../components/workflow/AddCoAuthorsDialog'
import { ComplianceCard } from '../components/workflow/ComplianceCard'
import { FileDialog } from '../components/workflow/FileDialog'
import { PeopleList } from '../components/workflow/PeopleList'
import { personWithRole } from '../components/workflow/people'
import { PreviewDialog } from '../components/workflow/PreviewDialog'
import { ResponseDialog } from '../components/workflow/ResponseDialog'
import { ResubmitDialog } from '../components/workflow/ResubmitDialog'
import { ReviewTimelineTable } from '../components/workflow/ReviewTimelineTable'
import { StatusTracker } from '../components/workflow/StatusTracker'
import { SubmitDialog } from '../components/workflow/SubmitDialog'
import { VersionHistory } from '../components/workflow/VersionHistory'
import { complianceEn } from '../content/compliance.en'
import { sopWorkflowEn } from '../content/workflow.en'
import type { SopVersion } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { currentCheck, hasCurrentCheck, isCheckRunning } from '../lib/compliance'
import { formatDate } from '../lib/format'
import { hasPermission } from '../lib/permissions'
import { sopPath } from '../lib/routes'
import {
  activeVersions,
  canResubmit,
  deleteVersionBlocker,
  isAuthorOrCoAuthor,
  latestReturn,
  nextVersion,
  responseRecipients,
  type UploadedFile,
} from '../lib/workflow'
import { useDepartments } from '../state/departmentsContext'
import { useGuidelines } from '../state/guidelinesContext'
import { useCurrentUser } from '../state/sessionContext'
import { useSops } from '../state/sopsContext'
import { useUsers } from '../state/usersContext'
import { NotFoundPage } from './NotFoundPage'

type DialogName = 'submit' | 'newVersion' | 'resubmit' | 'addCoAuthors' | 'response'

/*
 * Development-only demo controls (simulated reviewer and approver actions).
 * In a production build import.meta.env.DEV is false, so this becomes `null` and
 * the panel (with its text) is left out of the bundle entirely.
 */
const DemoPanel = import.meta.env.DEV ? lazy(() => import('../components/workflow/DemoPanel')) : null

/** Keeps the uploaded file in memory (object URL) so it can be downloaded in this session. */
function toUploadedFile(file: File): UploadedFile {
  // TODO: Upload the file to the backend instead of keeping it in browser memory.
  return {
    fileName: file.name,
    fileType: file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx',
    fileUrl: URL.createObjectURL(file),
  }
}

interface SectionProps {
  id: string
  title: string
  children: ReactNode
  className?: string
  /** Buttons shown next to the heading (below it on phones). */
  actions?: ReactNode
}

/** A titled card section of the workflow page. The heading can take focus (e.g. from the Returned note). */
function Section({ id, title, children, className = '', actions }: SectionProps) {
  return (
    <section aria-labelledby={id} className={`rounded-xl border border-beige bg-white p-5 sm:p-6 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} tabIndex={-1} className="scroll-mt-24 rounded-sm text-lg">
          {title}
        </h2>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/**
 * SOP workflow page ("/my-sops/:id"): the author's view of one SOP — workflow status,
 * SOP history (versions), authors, compliance overview and the review timeline
 * (PBI 6, 8, 12, 22, 24). Only the SOP's author and co-authors can open it;
 * co-authors can upload versions and respond, but only the main author submits
 * and deletes versions.
 */
export function SopWorkflowPage() {
  const content = sopWorkflowEn
  const { id } = useParams()
  const store = useSops()
  const user = useCurrentUser()
  const { nameOf } = useUsers()
  const departments = useDepartments()
  const guidelines = useGuidelines()
  const sop = store.sops.find((item) => item.id === id)
  const allowed = !!sop && hasPermission(user, 'author') && isAuthorOrCoAuthor(sop, user.id)
  useDocumentTitle(allowed ? content.pageTitle.replace('{code}', sop.code) : undefined)

  const [dialog, setDialog] = useState<DialogName | null>(null)
  // Co-author waiting for the remove confirmation.
  const [removingId, setRemovingId] = useState<string | null>(null)
  // Version waiting for the delete confirmation, and the version being previewed.
  const [deleting, setDeleting] = useState<SopVersion | null>(null)
  const [previewing, setPreviewing] = useState<SopVersion | null>(null)
  const [message, setMessage] = useState('')
  const triggerRef = useRef<HTMLElement | null>(null)
  const statusRef = useRef<HTMLDivElement>(null)

  if (!allowed) return <NotFoundPage embedded />

  const departmentName = departments.nameOf(sop.departmentId)
  const { dialogs, actions } = content
  const isMainAuthor = sop.authorId === user.id
  const authorName = nameOf(sop.authorId)

  function open(name: DialogName, trigger: HTMLElement) {
    triggerRef.current = trigger
    setMessage('')
    setDialog(name)
  }

  /** Focus goes back to the button that opened the dialog, or to the status message area if it's gone. */
  function returnFocus() {
    requestAnimationFrame(() => {
      const trigger = triggerRef.current
      if (trigger?.isConnected) trigger.focus()
      else statusRef.current?.focus()
    })
  }

  function closeDialog() {
    setDialog(null)
    returnFocus()
  }

  /** Closes the remove-co-author and delete-version confirmations and the preview. */
  function closeOverlay() {
    setRemovingId(null)
    setDeleting(null)
    setPreviewing(null)
    returnFocus()
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

  /** The Returned note's link: scroll to the Review timeline and move focus to its heading. */
  function goToTimeline(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    const heading = document.getElementById('timeline-title')
    if (!heading) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    heading.focus({ preventScroll: true })
    heading.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  }

  const returned = sop.status === 'returned' ? latestReturn(sop) : undefined
  const canUpload = sop.status === 'draft' || sop.status === 'returned'

  // Submit for review: Submit when Draft, Resubmit when Returned (main author only).
  // A completed compliance check of the current version, against the current GVP
  // version, is needed (it needn't pass); a resubmit also needs a version uploaded after the return.
  const checkRunning = isCheckRunning(sop)
  const checkDone = hasCurrentCheck(sop, guidelines.current.version)
  // A completed check of this version, but against an older GVP version: it must be rerun.
  const checkedOlder = currentCheck(sop)?.status === 'completed'
  const checkReason = checkDone
    ? undefined
    : checkRunning
      ? actions.checkWaiting
      : checkedOlder
        ? actions.checkCurrentNeeded.replace('{version}', guidelines.current.version)
        : actions.checkNeeded
  const submitReason = sop.status === 'returned' && !canResubmit(sop) ? actions.resubmitHint : checkReason

  // Response: to everyone who commented in the latest round; not once published.
  const recipients = sop.status === 'published' ? [] : responseRecipients(sop)

  // Delete version: Draft or Returned, main author, at least one version left.
  const blocker = deleteVersionBlocker(sop, user.id)
  const deleteReason = blocker && content.history.deleteBlocked[blocker].replace('{name}', authorName)
  // When the current version is deleted, the newest remaining one becomes current.
  const previousVersion = deleting
    ? activeVersions(sop)
        .filter((item) => item.version !== deleting.version)
        .reduce<SopVersion | undefined>((a, b) => (!a || Number(b.version) > Number(a.version) ? b : a), undefined)
    : undefined

  const sopId = sop.id
  function runCheck() {
    store.runCheck(sopId)
    announce(content.messages.checkStarted)
  }

  const [noteBefore, noteAfter] = content.returnedNote.text.split('{link}')

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

      {/* 1. Workflow status */}
      <Section id="tracker-title" title={content.tracker.label} className="mt-6">
        <StatusTracker sop={sop} content={content.tracker} />
        {returned && (
          <p className="mt-5 border-t border-beige pt-4 text-sm text-maroon">
            {noteBefore.replace('{name}', nameOf(returned.actorId))}
            <a
              href="#timeline-title"
              onClick={goToTimeline}
              className="rounded-sm font-medium underline underline-offset-2 hover:no-underline"
            >
              {content.returnedNote.link}
            </a>
            {noteAfter}
          </p>
        )}
      </Section>

      {/* 2. SOP history */}
      <Section
        id="history-title"
        title={content.history.title}
        className="mt-6"
        actions={
          <>
            {canUpload && (
              <Button size="sm" onClick={(event) => open('newVersion', event.currentTarget)}>
                <Upload aria-hidden="true" className="size-4" strokeWidth={2} />
                {content.history.upload}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={checkRunning}
              aria-describedby={checkRunning ? 'check-hint' : undefined}
              onClick={runCheck}
            >
              <ShieldCheck aria-hidden="true" className="size-4" strokeWidth={2} />
              {content.history.check}
            </Button>
            {sop.status === 'published' && (
              <Button size="sm" variant="secondary" to={sopPath(sop.id)}>
                {content.file.viewInDirectory}
                <ArrowUpRight aria-hidden="true" className="size-4" strokeWidth={2} />
              </Button>
            )}
          </>
        }
      >
        {checkRunning && (
          <p id="check-hint" className="mb-4 text-sm text-text-gray">
            {actions.checkWaiting}
          </p>
        )}
        <VersionHistory
          sop={sop}
          content={content}
          userId={user.id}
          deleteReason={deleteReason}
          onPreview={(version, trigger) => {
            triggerRef.current = trigger
            setPreviewing(version)
          }}
          onDelete={(version, trigger) => {
            triggerRef.current = trigger
            setMessage('')
            setDeleting(version)
          }}
        />
      </Section>

      {/* 3. Authors */}
      <Section id="authors-title" title={content.people.authorsTitle} className="mt-6">
        <PeopleList
          authorsOnly
          sop={sop}
          content={content.people}
          userId={user.id}
          canManageCoAuthors={isMainAuthor && sop.status !== 'published'}
          onAddCoAuthor={(trigger) => open('addCoAuthors', trigger)}
          onRemoveCoAuthor={(coAuthorId, trigger) => {
            triggerRef.current = trigger
            setMessage('')
            setRemovingId(coAuthorId)
          }}
        />
      </Section>

      {/* 4. Compliance overview: only once the current version has a check */}
      {currentCheck(sop) && (
        <Section id="compliance-title" title={complianceEn.card.title} className="mt-6">
          <ComplianceCard sop={sop} content={complianceEn} />
        </Section>
      )}

      {/* 5. Review timeline, with Response and Submit for review */}
      <Section
        id="timeline-title"
        title={content.timeline.title}
        className="mt-6"
        actions={
          (recipients.length > 0 || (isMainAuthor && canUpload)) && (
            <>
              {recipients.length > 0 && (
                <Button size="sm" variant="secondary" onClick={(event) => open('response', event.currentTarget)}>
                  <MessageSquareReply aria-hidden="true" className="size-4" strokeWidth={2} />
                  {actions.response}
                </Button>
              )}
              {isMainAuthor && canUpload && (
                <Button
                  size="sm"
                  disabled={!!submitReason}
                  aria-describedby={submitReason ? 'submit-hint' : undefined}
                  onClick={(event) => open(sop.status === 'returned' ? 'resubmit' : 'submit', event.currentTarget)}
                >
                  {actions.submit}
                </Button>
              )}
            </>
          )
        }
      >
        {canUpload && isMainAuthor && submitReason && (
          <p id="submit-hint" className="mb-4 text-sm text-text-gray">
            {submitReason}
          </p>
        )}
        {canUpload && !isMainAuthor && (
          <p className="mb-4 text-sm text-text-gray">{actions.authorOnly.replace('{name}', authorName)}</p>
        )}
        <ReviewTimelineTable sop={sop} content={content} />
      </Section>

      {DemoPanel && (
        <Suspense fallback={null}>
          <DemoPanel sop={sop} announce={announce} />
        </Suspense>
      )}

      {/* Dialogs */}
      {dialog === 'submit' && (
        <SubmitDialog
          sop={sop}
          content={dialogs}
          onClose={closeDialog}
          onSubmit={(options) => {
            store.submitForReview(sop.id, options)
            announce(content.messages.submitted)
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
      {dialog === 'newVersion' && (
        <FileDialog
          content={dialogs}
          title={dialogs.newVersion.title}
          description={dialogs.newVersion.description.replace('{version}', nextVersion(sop))}
          confirmLabel={dialogs.newVersion.confirm}
          onClose={closeDialog}
          onSubmit={(file) => {
            const version = nextVersion(sop)
            store.uploadVersion(sop.id, toUploadedFile(file))
            announce(content.messages.newVersion.replace('{version}', version))
          }}
        />
      )}
      {dialog === 'response' && (
        <ResponseDialog
          content={dialogs}
          recipients={recipients.map((recipient) => personWithRole(sop, recipient, content.roles, nameOf)).join(', ')}
          onClose={closeDialog}
          onSubmit={(text) => {
            store.addResponse(sop.id, text)
            announce(content.messages.responseSent)
          }}
        />
      )}
      {dialog === 'addCoAuthors' && (
        <AddCoAuthorsDialog
          sop={sop}
          content={dialogs}
          onClose={closeDialog}
          onSubmit={(userIds) => {
            store.addCoAuthors(sop.id, userIds)
            announce(content.messages.coAuthorsAdded)
          }}
        />
      )}
      <ConfirmDialog
        open={removingId !== null}
        title={dialogs.removeCoAuthor.title}
        description={dialogs.removeCoAuthor.description.replace('{name}', nameOf(removingId ?? undefined))}
        cancelLabel={dialogs.removeCoAuthor.keep}
        confirmLabel={dialogs.removeCoAuthor.confirm}
        onCancel={closeOverlay}
        onConfirm={() => {
          if (!removingId) return
          const name = nameOf(removingId)
          store.removeCoAuthor(sop.id, removingId)
          closeOverlay()
          announce(content.messages.coAuthorRemoved.replace('{name}', name))
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={dialogs.deleteVersion.title.replace('{version}', deleting?.version ?? '')}
        description={[
          dialogs.deleteVersion.description.replaceAll('{version}', deleting?.version ?? ''),
          ...(deleting?.version === sop.version && previousVersion
            ? [dialogs.deleteVersion.currentNote.replace('{previous}', previousVersion.version)]
            : []),
        ].join(' ')}
        cancelLabel={dialogs.deleteVersion.keep}
        confirmLabel={dialogs.deleteVersion.confirm}
        onCancel={closeOverlay}
        onConfirm={() => {
          if (!deleting) return
          const version = deleting.version
          store.deleteVersion(sop.id, version)
          closeOverlay()
          announce(content.messages.versionDeleted.replace('{version}', version))
        }}
      />
      {previewing?.fileUrl && (
        <PreviewDialog
          title={content.history.previewTitle.replace('{code}', sop.code).replace('{version}', previewing.version)}
          url={previewing.fileUrl}
          viewerTitle={content.history.viewerTitle
            .replace('{code}', sop.code)
            .replace('{title}', sop.title)
            .replace('{version}', previewing.version)}
          closeLabel={content.history.close}
          fallback={content.history.fallback}
          onClose={closeOverlay}
        />
      )}
    </>
  )
}
