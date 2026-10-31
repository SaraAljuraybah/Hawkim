import { useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, CircleCheck, MessageSquareReply, ShieldCheck, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FormDialog } from '../components/ui/FormDialog'
import { Tooltip } from '../components/ui/Tooltip'
import { AddCoAuthorsDialog } from '../components/workflow/AddCoAuthorsDialog'
import { ComplianceCard } from '../components/workflow/ComplianceCard'
import { FileDialog } from '../components/workflow/FileDialog'
import { InternalReviewPanel } from '../components/workflow/InternalReviewPanel'
import { PeopleList } from '../components/workflow/PeopleList'
import { personWithRole } from '../components/workflow/people'
import { PreviewDialog } from '../components/workflow/PreviewDialog'
import { ResponseDialog } from '../components/workflow/ResponseDialog'
import { ResubmitDialog } from '../components/workflow/ResubmitDialog'
import { ReviewTimelineTable } from '../components/workflow/ReviewTimelineTable'
import { StatusTracker } from '../components/workflow/StatusTracker'
import { SubmitDialog } from '../components/workflow/SubmitDialog'
import { SubmitForApprovalDialog } from '../components/workflow/SubmitForApprovalDialog'
import { VersionHistory } from '../components/workflow/VersionHistory'
import { complianceEn } from '../content/compliance.en'
import { approvalEn } from '../content/approval.en'
import { internalReviewEn } from '../content/internalReview.en'
import { sopWorkflowEn } from '../content/workflow.en'
import type { Sop, SopVersion } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { checkRequired, currentCheck, hasCurrentCheck, isCheckRunning } from '../lib/compliance'
import { approvalReadiness, type ApprovalReadiness } from '../lib/approval'
import { canAddReviewers, canSendNewVersion, currentInternalRound, type ReviewPhaseItem } from '../lib/internalReview'
import { reviewAllowsNewVersion } from '../lib/internalReviewStatus'
import { formatDate } from '../lib/format'
import { hasPermission } from '../lib/permissions'
import { sopPath } from '../lib/routes'
import {
  activeVersions,
  canResubmit,
  checkBlocker,
  deleteVersionBlocker,
  isAuthorOrCoAuthor,
  nextVersion,
  responseRecipients,
} from '../lib/workflow'
import { fileUrlOf } from '../lib/prototypeFiles'
import { useDepartments } from '../state/departmentsContext'
import { useGuidelines } from '../state/guidelinesContext'
import { useCurrentUser } from '../state/sessionContext'
import { useSops } from '../state/sopsContext'
import { useUsers } from '../state/usersContext'
import { NotFoundPage } from './NotFoundPage'

type DialogName = 'submit' | 'addReviewers' | 'approval' | 'newVersion' | 'resubmit' | 'addCoAuthors' | 'response'

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
 * authors, SOP history (versions), compliance overview, reviewers and the review timeline
 * (PBI 6, 8, 12, 22, 24). Only the SOP's author and co-authors can open it;
 * co-authors can upload versions and respond, delete the versions they uploaded and
 * run the compliance check when they uploaded the current version; only the main
 * author submits.
 */
export function SopWorkflowPage() {
  const content = sopWorkflowEn
  const { id } = useParams()
  const store = useSops()
  const user = useCurrentUser()
  const { nameOf, users } = useUsers()
  const departments = useDepartments()
  const guidelines = useGuidelines()
  const sop = store.sops.find((item) => item.id === id)
  const allowed = !!sop && hasPermission(user, 'author') && isAuthorOrCoAuthor(sop, user.id)
  useDocumentTitle(allowed ? content.pageTitle.replace('{title}', sop.title) : undefined)

  const [dialog, setDialog] = useState<DialogName | null>(null)
  // Co-author waiting for the remove confirmation.
  const [removingId, setRemovingId] = useState<string | null>(null)
  // Version waiting for the delete confirmation, and the version being previewed.
  const [deleting, setDeleting] = useState<SopVersion | null>(null)
  const [previewing, setPreviewing] = useState<{ version: SopVersion; url: string } | null>(null)
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState('')
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

  const internal = !!sop.internalReviewRounds?.length
  // Upload: Draft or Returned, or during internal review once every reviewer has finished the current version.
  const canUpload = sop.status === 'draft' || sop.status === 'returned' || reviewAllowsNewVersion(sop)
  // Submit for review from Draft, or Resubmit a legacy SOP; internal reviews use Submit for review (add reviewers or a new version) afterwards.
  const canSubmit = sop.status === 'draft' || sop.status === 'returned' && !internal

  // Submit for review: Submit when Draft, Resubmit when Returned (main author only).
  // A current compliance check is needed only where the department's GVP guideline applies;
  // a resubmit also needs a version uploaded after the return.
  const needsCheck = checkRequired(sop, departments.departments)
  const checkRunning = isCheckRunning(sop)
  const checkDone = !needsCheck || hasCurrentCheck(sop, guidelines.current.version)
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
  // Legacy review plans keep their existing handoff. Parallel reviews await this main-Author action.
  // Submit for review during internal review: the current version to more reviewers, or a new version (once checked) to the reviewers chosen.
  const addReviewers = isMainAuthor && canAddReviewers(sop)
  const sendVersion = isMainAuthor && internal && canSendNewVersion(sop)
  const requestReason = sendVersion ? checkReason : undefined
  // Submit for approval stays visible (Draft, In Review, and Returned after an approver return); it's disabled until ready.
  const showApproval = isMainAuthor && (sop.status === 'draft' || internal) && sop.status !== 'approved' && sop.status !== 'published'
  const approval = showApproval
    ? approvalReadiness(sop, user.id, { users, departments: departments.departments }, {
        noExternalReviewsRequired: true,
        feedbackAddressed: true,
      })
    : undefined

  /** One reviewer still to finish the latest version (or nobody taking part), as a line of the missing list. */
  function missingText(item: ReviewPhaseItem): string {
    const text = internalReviewEn.approvalMissing
    if (item.kind === 'no-reviewers') return text.noReviewers
    const template = item.kind === 'respond' ? text.respond : item.kind === 'finish' ? text.finish : text.returned
    return template.replace('{name}', nameOf(item.userId)).replace('{version}', 'version' in item ? item.version : '')
  }
  /**
   * The approval tooltip's lines: the reviewers still missing, then the other reasons in simple words.
   * Display only: the codes come from approvalReadiness, unchanged.
   */
  function approvalLines(readiness: ApprovalReadiness, current: Sop): string[] {
    const blocked = approvalEn.blockers
    const requested = readiness.blockers.includes('already-requested')
    const latest = current.approvalSubmissions?.at(-1)
    return [...readiness.missing.map(missingText), ...readiness.blockers.flatMap((code, index) => {
      // "Already sent" (or the approver's return) explains it; "not in review" would only repeat it.
      if (code === 'not-in-review' && requested) return []
      if (code === 'already-requested' && current.status === 'returned') {
        // After a new version is uploaded, the reviewer line says what's next.
        return latest?.status === 'returned' && latest.version === current.version ? [approvalEn.returnedByApprover] : []
      }
      return [code in blocked ? blocked[code as keyof typeof blocked] : readiness.reasons[index]]
    })]
  }
  // Response: to everyone who commented in the latest round; not once published.
  const recipients = sop.status === 'published' ? [] : responseRecipients(sop)

  // Compliance check: only where the GVP guideline applies; hidden once Approved or Published; disabled
  // In Review and In Approval (that reason wins); otherwise the main author, or a co-author who uploaded the current version.
  const showCheck = needsCheck && sop.status !== 'approved' && sop.status !== 'published'
  const checkBlock = checkBlocker(sop, user.id)
  const checkBlockedReason =
    checkBlock === 'status'
      ? content.history.checkBlocked.status[sop.status as keyof typeof content.history.checkBlocked.status]
      : checkBlock && content.history.checkBlocked['not-uploader'].replace('{name}', authorName)

  // Delete version: Draft or Returned, main author (any version) or its uploader, at least one version left.
  const { deleteBlocked } = content.history
  const historySop = sop
  function deleteReason(version: SopVersion): string | undefined {
    const blocker = deleteVersionBlocker(historySop, user.id, version.version)
    if (!blocker) return undefined
    // 'status': the SOP is In Review, In Approval, Approved or Published.
    if (blocker === 'status') return deleteBlocked.status[historySop.status as keyof typeof deleteBlocked.status]
    return deleteBlocked[blocker].replace('{name}', authorName)
  }
  // When the current version is deleted, the newest remaining one becomes current.
  const previousVersion = deleting
    ? activeVersions(sop)
        .filter((item) => item.version !== deleting.version)
        .reduce<SopVersion | undefined>((a, b) => (!a || Number(b.version) > Number(a.version) ? b : a), undefined)
    : undefined

  const sopId = sop.id
  function runCheck() {
    setMessage('')
    store.runCheck(sopId).then(
      () => announce(content.messages.checkStarted),
      () => announce(content.messages.checkStartFailed),
    )
  }


  return (
    <>
      <Link
        to={content.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {content.back.label}
      </Link>

      {/* Header (no status badge: the Workflow status steps show the status) */}
      <div className="mt-5">
        <h1 className="mt-1 text-2xl leading-tight tracking-tight sm:text-3xl">{sop.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-text-gray">
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

      {sop.description?.trim() && (
        <Card title={content.descriptionTitle} titleId="description-title" className="mt-6">
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-maroon">{sop.description}</p>
        </Card>
      )}

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
        {/* Only the steps: who returned it and why, and who's next, are in the Review timeline and the Reviewers box. */}
        <StatusTracker sop={sop} content={content.tracker} stepsOnly />
      </Section>

      {/* 2. Authors */}
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
            setActionError('')
            setRemovingId(coAuthorId)
          }}
        />
      </Section>

      {/* 3. SOP history */}
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
            {!showCheck ? null : checkBlockedReason ? (
              // Not allowed now: stays focusable (aria-disabled) so the tooltip's reason can be read.
              <Tooltip text={checkBlockedReason}>
                {(tooltipId) => (
                  <Button size="sm" grayWhenDisabled aria-disabled aria-describedby={tooltipId}>
                    <ShieldCheck aria-hidden="true" className="size-4" strokeWidth={2} />
                    {content.history.check}
                  </Button>
                )}
              </Tooltip>
            ) : (
              <Button
                size="sm"
                grayWhenDisabled
                disabled={checkRunning}
                aria-describedby={checkRunning ? 'check-hint' : undefined}
                onClick={runCheck}
              >
                <ShieldCheck aria-hidden="true" className="size-4" strokeWidth={2} />
                {content.history.check}
              </Button>
            )}
            {sop.status === 'published' && (
              <Button size="sm" to={sopPath(sop.id)}>
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
            setMessage('')
            fileUrlOf(version).then(
              (url) => (url ? setPreviewing({ version, url }) : announce(content.messages.fileFailed)),
              () => announce(content.messages.fileFailed),
            )
          }}
          onDownload={(version, fileName) => {
            setMessage('')
            fileUrlOf(version, fileName).then(
              (url) => (url ? window.location.assign(url) : announce(content.messages.fileFailed)),
              () => announce(content.messages.fileFailed),
            )
          }}
          onDelete={(version, trigger) => {
            triggerRef.current = trigger
            setMessage('')
            setActionError('')
            setDeleting(version)
          }}
        />
      </Section>

      {/* 4. Compliance overview (says so when the current version hasn't been checked yet) */}
      {needsCheck && <Section id="compliance-title" title={complianceEn.card.title} className="mt-6">
        <ComplianceCard sop={sop} content={complianceEn} />
      </Section>}

      {/* Review actions stay with the reviewers, including before the first request. */}
      <InternalReviewPanel
        sop={sop}
        canRemove={isMainAuthor}
        activeOnly
        compact
        showEmpty
        title={internalReviewEn.panel.authorPageTitle}
        actions={
          (recipients.length > 0 || (isMainAuthor && canSubmit) || addReviewers || sendVersion || showApproval) && (
            <>
              {recipients.length > 0 && (
                <Button size="sm" variant="secondary" onClick={(event) => open('response', event.currentTarget)}>
                  <MessageSquareReply aria-hidden="true" className="size-4" strokeWidth={2} />
                  {actions.response}
                </Button>
              )}
              {isMainAuthor && canSubmit && (
                <Button
                  size="sm"
                  disabled={!!submitReason}
                  aria-describedby={submitReason ? 'submit-hint' : undefined}
                  onClick={(event) => open(sop.status === 'returned' ? 'resubmit' : 'submit', event.currentTarget)}
                >
                  {sop.status === 'returned' ? actions.resubmit : actions.submit}
                </Button>
              )}
              {(addReviewers || sendVersion) && (
                <Button size="sm" disabled={!!requestReason} aria-describedby={requestReason ? 'submit-hint' : undefined}
                  onClick={(event) => open(sendVersion ? 'submit' : 'addReviewers', event.currentTarget)}>{actions.submit}</Button>
              )}
              {showApproval && (approval?.ready ? (
                <Button size="sm" grayWhenDisabled onClick={(event) => open('approval', event.currentTarget)}>{approvalEn.action}</Button>
              ) : (
                // Not available yet: grey and aria-disabled, so it stays focusable; the tooltip says why
                // (on hover, keyboard focus or a tap) and is read with the button.
                <Tooltip openOnTap wide text={<>
                  <span className="block font-semibold">{internalReviewEn.approvalMissing.title}</span>
                  {approval && approvalLines(approval, sop).map((line) => <span key={line} className="ml-4 list-item list-disc">{line}</span>)}
                </>}>
                  {(tooltipId) => (
                    <Button size="sm" grayWhenDisabled aria-disabled aria-describedby={tooltipId}>{approvalEn.action}</Button>
                  )}
                </Tooltip>
              ))}
            </>
          )
        }
      >
        {isMainAuthor && sop.status === 'in-review' && currentInternalRound(sop)?.status === 'completed' && (
          <p className="mb-4 text-sm leading-relaxed text-text-gray">{internalReviewEn.panel.externalPending}</p>
        )}
        {isMainAuthor && (canSubmit && submitReason || requestReason) && (
          <p id="submit-hint" className="mb-4 text-sm text-text-gray">
            {canSubmit ? submitReason : requestReason}
          </p>
        )}
        {canUpload && !isMainAuthor && (
          <p className="mb-4 text-sm text-text-gray">{actions.authorOnly.replace('{name}', authorName)}</p>
        )}
      </InternalReviewPanel>

      {/* The timeline contains historical events only. */}
      <Section id="timeline-title" title={content.timeline.title} className="mt-6">
        <ReviewTimelineTable sop={sop} content={content} mainAuthorOnly />
      </Section>


      {/* Dialogs */}
      {dialog === 'approval' && (
        <SubmitForApprovalDialog sop={sop} onClose={closeDialog}
          onSubmit={(options) => {
            store.submitForApproval(sop.id, options)
            announce(approvalEn.submitted)
          }} />
      )}
      {dialog === 'submit' && (
        <SubmitDialog
          mode={sendVersion ? 'version' : 'submit'}
          sop={sop}
          content={dialogs}
          onClose={closeDialog}
          onSubmit={async (options) => {
            await store.submitForReview(sop.id, options)
            announce(content.messages.submitted)
          }}
        />
      )}
      {dialog === 'addReviewers' && (
        <SubmitDialog
          mode="add"
          sop={sop}
          content={dialogs}
          onClose={closeDialog}
          onSubmit={async (options) => {
            await store.addInternalReviewers(sop.id, options)
            announce(content.messages.submitted)
          }}
        />
      )}
      {dialog === 'resubmit' && (
        <ResubmitDialog
          sop={sop}
          content={dialogs}
          onClose={closeDialog}
          onSubmit={(options) => {
            store.resubmit(sop.id, options)
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
          onSubmit={async (file) => {
            const version = nextVersion(sop)
            await store.uploadVersion(sop.id, file)
            announce(content.messages.newVersion.replace('{version}', version))
          }}
        />
      )}
      {dialog === 'response' && (
        <ResponseDialog
          content={dialogs}
          recipients={recipients.map((recipient) => personWithRole(sop, recipient, content.roles, nameOf)).join(', ')}
          onClose={closeDialog}
          onSubmit={async (text) => {
            await store.addResponse(sop.id, text)
            announce(content.messages.responseSent)
          }}
        />
      )}
      {dialog === 'addCoAuthors' && (
        <AddCoAuthorsDialog
          sop={sop}
          content={dialogs}
          onClose={closeDialog}
          onSubmit={async (userIds) => {
            await store.addCoAuthors(sop.id, userIds)
            announce(content.messages.coAuthorsAdded)
          }}
        />
      )}
      <FormDialog
        open={removingId !== null}
        title={dialogs.removeCoAuthor.title}
        description={dialogs.removeCoAuthor.description.replace('{name}', nameOf(removingId ?? undefined))}
        cancelLabel={dialogs.removeCoAuthor.keep}
        confirmLabel={dialogs.removeCoAuthor.confirm}
        onClose={closeOverlay}
        onConfirm={async () => {
          if (!removingId) return
          const name = nameOf(removingId)
          try { await store.removeCoAuthor(sop.id, removingId) }
          catch {
            setActionError(content.messages.coAuthorRemoveFailed.replace('{name}', name))
            return false
          }
          closeOverlay()
          announce(content.messages.coAuthorRemoved.replace('{name}', name))
        }}
      >
        {actionError && <p role="alert" className="text-sm text-status-rejected-fg">{actionError}</p>}
      </FormDialog>
      <FormDialog
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
        onClose={closeOverlay}
        onConfirm={async () => {
          if (!deleting) return
          const version = deleting.version
          try { await store.deleteVersion(sop.id, version) }
          catch {
            setActionError(content.messages.deleteFailed.replace('{version}', version))
            return false
          }
          closeOverlay()
          announce(content.messages.versionDeleted.replace('{version}', version))
        }}
      >
        {actionError && <p role="alert" className="text-sm text-status-rejected-fg">{actionError}</p>}
      </FormDialog>
      {previewing && (
        <PreviewDialog
          title={content.history.previewTitle.replace('{title}', sop.title).replace('{version}', previewing.version.version)}
          url={previewing.url}
          viewerTitle={content.history.viewerTitle
            .replace('{title}', sop.title)
            .replace('{version}', previewing.version.version)}
          closeLabel={content.history.close}
          fallback={content.history.fallback}
          onClose={closeOverlay}
        />
      )}
    </>
  )
}
