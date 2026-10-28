import { useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CircleCheck, Download, FileText, LoaderCircle } from 'lucide-react'
import { ComplianceSummary, SampleBanner } from '../components/compliance/ComplianceSummary'
import { InternalReviewActions } from '../components/reviews/InternalReviewActions'
import { InternalReviewPanel } from '../components/workflow/InternalReviewPanel'
import { internalReviewEn } from '../content/internalReview.en'
import { currentInternalRound, isInternalReviewPending } from '../lib/internalReview'
import { ReviewFlowActions } from '../components/reviews/ReviewFlowActions'
import { CommentDialog, RouteDialog } from '../components/reviews/ReviewDialogs'
import { PdfViewer } from '../components/sops/PdfViewer'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { StatusBadge } from '../components/ui/StatusBadge'
import { CommentList } from '../components/workflow/CommentList'
import { ReviewerDeadline } from '../components/workflow/ReviewerDeadline'
import { PeopleList } from '../components/workflow/PeopleList'
import { StatusTracker } from '../components/workflow/StatusTracker'
import { ReviewTimelineTable } from '../components/workflow/ReviewTimelineTable'
import { complianceEn } from '../content/compliance.en'
import { reviewsEn } from '../content/reviews.en'
import { sopWorkflowEn } from '../content/workflow.en'
import type { ApprovalDecisionSnapshot, Sop } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { currentVersionOf, useFileUrl } from '../hooks/useFileUrl'
import { checkRequired, complianceScore, currentCheck, verdictOf } from '../lib/compliance'
import { sopDownloadName, sopFileLabel } from '../lib/sopPresentation'
import { formatDateTime } from '../lib/format'
import { reviewCompliancePath } from '../lib/routes'
import { reviewSopForUser } from '../lib/reviewAccess'
import { fileUrlOf } from '../services/files'
import { activeApprovalSubmission, currentDueAt, currentReviewer, isOverdue, latestReturn, pendingPeople } from '../lib/workflow'
import { useDepartments } from '../state/departmentsContext'
import { useCurrentUser } from '../state/sessionContext'
import { useSops } from '../state/sopsContext'
import { useUsers } from '../state/usersContext'
import { NotFoundPage } from './NotFoundPage'

type DialogName = 'complete' | 'returnReviewer' | 'route' | 'approve' | 'returnApprover' | 'publish'

/** A title-based download name; the stored SOP identifier and uploaded file stay intact. */
function downloadName(sop: Sop) {
  return sopDownloadName(sop.title, sop.version, sop.fileType)
}

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
 * Review page ("/reviews/:id", PBI 7–12, 23, 25): an SOP seen by one of its reviewers or
 * approvers: status, people, the file, the compliance summary, comments and timeline,
 * and the actions the workflow rules allow them right now (complete or return a review,
 * route to another department, approve or return, publish). Anyone not assigned to the
 * SOP gets Not Found.
 */
export function ReviewPage() {
  const { id } = useParams()
  const { sops } = useSops()
  const user = useCurrentUser()
  const sop = sops.find((item) => item.id === id)
  const access = sop ? reviewSopForUser(sop, user.id) : undefined
  useDocumentTitle(access ? reviewsEn.page.pageTitle.replace('{title}', access.sop.title) : undefined)

  if (!access) return <NotFoundPage embedded />
  // Reset dialogs when the authorized version or signed-in reviewer changes.
  return <Review key={`${access.sop.id}:${access.sop.version}:${user.id}`} sop={access.sop} historical={access.historical} />
}

function Review({ sop, historical }: { sop: Sop; historical: boolean }) {
  const text = reviewsEn.page
  const fileUrl = useFileUrl(sop)
  const workflow = sopWorkflowEn
  const store = useSops()
  const user = useCurrentUser()
  const { nameOf, getUser } = useUsers()
  const { nameOf: departmentName, departments } = useDepartments()

  const [dialog, setDialog] = useState<DialogName | null>(null)
  const [approvalSnapshot, setApprovalSnapshot] = useState<ApprovalDecisionSnapshot>()
  const [message, setMessage] = useState('')
  const [fileError, setFileError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const statusRef = useRef<HTMLDivElement>(null)

  const department = departmentName(sop.departmentId)
  const internalRound = currentInternalRound(sop)
  const reviewer = sop.reviewers.find((person) => person.userId === user.id) ?? [...(sop.internalReviewRounds ?? [])].reverse().flatMap((round) => round.assignments).find((person) => person.userId === user.id)
  const approver = sop.approvers.find((person) => person.userId === user.id)
  const approvalSubmission = activeApprovalSubmission(sop)
  const approvalPhase = !internalRound || !!approvalSubmission
  const approvalPermission = !internalRound || !user.deletedAt && !user.permissions.includes('admin') && user.permissions.includes('approver')
  const canReview = !historical && (internalRound ? isInternalReviewPending(sop, user.id) : sop.status === 'in-review' && currentReviewer(sop)?.userId === user.id)
  const canApprove = !historical && approvalPhase && approvalPermission && sop.status === 'in-approval' && approver?.decision === 'pending'
  const canPublish = !historical && approvalPhase && approvalPermission && sop.status === 'approved' && !!approver
  // Only the current reviewer can complete, return or append a reviewer to the queue.
  const canRoute = !internalRound && canReview

  const dueAt = currentDueAt(sop)
  const overdue = !!dueAt && isOverdue(sop, sop.status === 'in-approval' ? 'approval' : 'review')
  const coAuthors = sop.coAuthorIds.map((coAuthorId) => nameOf(coAuthorId)).join(', ')
  const check = currentCheck(sop)

  function open(name: DialogName, trigger: HTMLElement) {
    triggerRef.current = trigger
    setMessage('')
    setApprovalSnapshot(approvalSubmission ? { version: sop.version, approvalSubmissionId: approvalSubmission.id } : undefined)
    setDialog(name)
  }

  function close() {
    setDialog(null)
    requestAnimationFrame(() => {
      const trigger = triggerRef.current
      if (trigger?.isConnected) trigger.focus()
      else statusRef.current?.focus()
    })
  }

  async function download() {
    if (downloading) return
    setFileError('')
    setDownloading(true)
    try {
      const url = await fileUrlOf(currentVersionOf(sop) ?? sop, downloadName(sop))
      if (!url) throw new Error('Unavailable')
      window.location.assign(url)
    } catch { setFileError(text.fileFailed) }
    finally { setDownloading(false) }
  }
  const stored = !!currentVersionOf(sop)?.storagePath

  /** Runs an action, says what happened, and moves focus to the message (the buttons change). */
  function act(action: () => void, done: string) {
    action()
    setDialog(null)
    flushSync(() => setMessage(done))
    statusRef.current?.focus()
  }

  /** What the user sees when there's nothing for them to do now. */
  function statusLines(): string[] {
    const date = (iso?: string) => (iso ? formatDateTime(iso) : '')
    if (sop.status === 'published') {
      const published = [...sop.timeline].reverse().find((event) => event.type === 'published')
      return [text.status.published.replace('{date}', date(published?.createdAt))]
    }
    if (sop.status === 'returned') return [text.status.returned.replace('{date}', date(latestReturn(sop)?.createdAt))]
    if (internalRound && !approver && (sop.status === 'in-review' || sop.status === 'draft')) return [reviewer?.decision === 'cancelled' ? internalReviewEn.status.cancelled : internalRound.status === 'completed' ? internalReviewEn.status.awaitingAuthor : internalRound.status !== 'open' ? internalReviewEn.status.closed : reviewer?.decision === 'completed' ? internalReviewEn.actions.completed : ''] .filter(Boolean)
    const lines: string[] = []
    if (reviewer?.decision === 'completed') lines.push(text.status.reviewCompleted.replace('{date}', date(reviewer.decidedAt)))
    if (approver && sop.status === 'in-review') lines.push(text.status.waitingForReviews)
    if (approver?.decision === 'approved') lines.push(text.status.approved.replace('{date}', date(approver.decidedAt)))
    const others = pendingPeople(sop).filter((person) => person.userId !== user.id)
    if (others.length > 0 && !(approver && sop.status === 'in-review')) {
      const names = others
        .map((person) => `${nameOf(person.userId)} (${person.role === 'reviewer' ? workflow.roles.reviewer : workflow.roles.approver})`)
        .join(', ')
      lines.push(text.status.waitingFor.replace('{names}', names))
    }
    return lines
  }

  // Something needed from the user now (otherwise status lines say where things stand).
  const decisionNeeded = canReview || canApprove || canPublish

  return (
    <>
      <Link
        to={text.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {text.back.label}
      </Link>

      {/* Header */}
      <div className="mt-5">
        <h1 className="mt-1 text-2xl leading-tight tracking-tight sm:text-3xl">{sop.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-text-gray">
          <StatusBadge status={sop.status} />
          <span>{workflow.versionTemplate.replace('{version}', sop.version)}</span>
          <span aria-hidden="true">·</span>
          <span>
            <span className="sr-only">{workflow.departmentLabel}: </span>
            {department}
          </span>
        </div>
        <p className="mt-2 text-sm text-text-gray">
          {text.author.replace('{name}', nameOf(sop.authorId))}
          {coAuthors && (
            <>
              <span aria-hidden="true"> · </span>
              <span className="sr-only">, </span>
              {text.coAuthors.replace('{names}', coAuthors)}
            </>
          )}
        </p>
        {dueAt && sop.status !== 'in-review' && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-maroon">
            <span>
              {text.due.split('{date}')[0]}
              <time dateTime={dueAt}>{formatDateTime(dueAt)}</time>
              {text.due.split('{date}')[1]}
            </span>
            {overdue && (
              <span className="inline-flex rounded-full bg-status-rejected-bg px-2 py-0.5 text-xs font-medium text-status-rejected-fg">
                {text.overdue}
              </span>
            )}
          </p>
        )}
      </div>

      {sop.status === 'in-review' && (reviewer ?? currentReviewer(sop)) && (
        <div className="mt-3">
          <ReviewerDeadline sop={sop} reviewer={(reviewer ?? currentReviewer(sop))!} content={workflow.reviewerDeadline} showQueue />
        </div>
      )}

      {sop.description?.trim() && (
        <Card title={workflow.descriptionTitle} titleId="description-title" className="mt-6">
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

      {/* Actions the rules allow now, or where things stand */}
      <Section id="actions-title" title={text.actions.title} className="mt-6">
        {internalRound && canReview && <InternalReviewActions key={internalRound.id} sop={sop} onComplete={(done) => { flushSync(() => setMessage(done)); statusRef.current?.focus() }} />}
        {sop.reviewFlow && canReview && <ReviewFlowActions key={sop.reviewFlow.stage + user.id} sop={sop} onComplete={(done) => { flushSync(() => setMessage(done)); statusRef.current?.focus() }} />}
        {!decisionNeeded && (
          <ul className="space-y-1 text-sm text-maroon">
            {statusLines().map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {!(internalRound && canReview) && (decisionNeeded || canRoute) && !(sop.reviewFlow && canReview) && (
          <div className={`flex flex-col gap-3 sm:flex-row sm:flex-wrap ${decisionNeeded ? '' : 'mt-4'}`}>
            {canReview && !sop.reviewFlow && (
              <>
                <Button onClick={(event) => open('complete', event.currentTarget)}>{text.actions.completeReview}</Button>
                <Button variant="secondary" onClick={(event) => open('returnReviewer', event.currentTarget)}>
                  {text.actions.returnToAuthor}
                </Button>
              </>
            )}
            {canRoute && !sop.reviewFlow && (
              <Button variant="secondary" className="sm:self-start" onClick={(event) => open('route', event.currentTarget)}>
                {text.actions.route}
              </Button>
            )}
            {canApprove && (
              <>
                <Button onClick={(event) => open('approve', event.currentTarget)}>{text.actions.approve}</Button>
                <Button variant="secondary" onClick={(event) => open('returnApprover', event.currentTarget)}>
                  {text.actions.returnToAuthor}
                </Button>
              </>
            )}
            {canPublish && <Button onClick={(event) => open('publish', event.currentTarget)}>{text.actions.publish}</Button>}
          </div>
        )}
      </Section>

      <Section id="tracker-title" title={workflow.tracker.label} className="mt-6">
        <StatusTracker sop={sop} content={workflow.tracker} />
      </Section>

      {internalRound && <InternalReviewPanel sop={sop} canRemove={false} />}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Section id="people-title" title={workflow.people.title}>
          <PeopleList
            sop={sop}
            content={workflow.people}
            userId={user.id}
            canManageCoAuthors={false}
            onAddCoAuthor={() => {}}
            onRemoveCoAuthor={() => {}}
          />
        </Section>

        {/* Compliance (read-only) */}
        {checkRequired(sop, departments) && <Section id="compliance-title" title={text.compliance.title}>
          <SampleBanner text={complianceEn.sampleBanner} />
          <div className="mt-4">
            {check?.status === 'completed' ? (
              <>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-2xl font-semibold text-maroon tabular-nums" aria-label={text.compliance.score.replace('{score}', String(complianceScore(check)))}>
                    {complianceScore(check)}%
                  </span>
                  <span className="text-sm font-semibold text-maroon">{complianceEn.report.summary.verdicts[verdictOf(check)]}</span>
                </p>
                <p className="mt-1 text-sm text-text-gray">
                  {complianceEn.guideline.replace('{name}', check.guideline.name).replace('{version}', check.guideline.version)}
                </p>
                <div className="mt-4">
                  <ComplianceSummary check={check} content={complianceEn} />
                </div>
                <Button size="sm" to={reviewCompliancePath(sop.id)} className="mt-5">
                  {text.compliance.viewReport}
                  <ArrowRight aria-hidden="true" className="size-4" strokeWidth={2} />
                </Button>
              </>
            ) : check?.status === 'running' ? (
              <p className="flex items-center gap-2.5 text-sm font-medium text-maroon">
                <LoaderCircle aria-hidden="true" className="size-5 shrink-0 motion-safe:animate-spin" strokeWidth={2} />
                {text.compliance.running}
              </p>
            ) : (
              <p className="text-sm text-text-gray">{text.compliance.none}</p>
            )}
          </div>
        </Section>}
      </div>

      {/* Current file: the PDF inline; a download for files uploaded in this session; the name only for samples */}
      <Section id="file-title" title={text.file.title} className="mt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-maroon/[0.07] text-maroon">
              <FileText className="size-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium break-all text-maroon">{sopFileLabel(sop)}</p>
              <p className="mt-0.5 text-sm text-text-gray">
                {workflow.file.types[sop.fileType]} · {workflow.versionTemplate.replace('{version}', sop.version)}
              </p>
            </div>
          </div>
          {fileUrl && (
            <Button href={stored ? undefined : fileUrl} download={stored ? undefined : downloadName(sop)}
              onClick={stored ? download : undefined} disabled={downloading} size="sm" variant="secondary" className="self-start sm:self-auto">
              <Download aria-hidden="true" className="size-4" strokeWidth={2} />
              {text.file.download}
            </Button>
          )}
        </div>
        {fileError && <p role="alert" className="mt-3 text-sm text-status-rejected-fg">{fileError}</p>}
        {fileUrl && sop.fileType === 'pdf' && (
          <div className="mt-4 rounded-xl border border-beige p-3 sm:p-4">
            <PdfViewer
              url={fileUrl}
              title={text.file.viewerTitle.replace('{title}', sop.title)}
              fallback={text.file.fallback}
            />
          </div>
        )}
      </Section>

      <Section id="comments-title" title={workflow.comments.title} className="mt-6">
        <CommentList sop={sop} content={workflow} />
      </Section>

      <Section id="timeline-title" title={workflow.timeline.title} className="mt-6">
        <ReviewTimelineTable sop={sop} content={workflow} />
      </Section>

      {/* Dialogs */}
      {dialog === 'complete' && (
        <CommentDialog
          text={text.dialogs.complete}
          dialogs={text.dialogs}
          onClose={close}
          onConfirm={(comment) => act(() => store.completeReview(sop.id, user.id, comment), text.messages.completed)}
        />
      )}
      {dialog === 'returnReviewer' && (
        <CommentDialog
          text={text.dialogs.return}
          dialogs={text.dialogs}
          required
          onClose={close}
          onConfirm={(comment) => act(() => store.returnAsReviewer(sop.id, user.id, comment), text.messages.returned)}
        />
      )}
      {dialog === 'route' && (
        <RouteDialog
          sop={sop}
          dialogs={text.dialogs}
          onClose={close}
          onConfirm={(reviewerId, note) =>
            act(
              () => store.routeToReviewer(sop.id, user.id, reviewerId, note),
              text.messages.routed.replace('{name}', nameOf(reviewerId)).replace('{department}', departmentName(getUser(reviewerId)?.departmentId)),
            )
          }
        />
      )}
      {dialog === 'approve' && (
        <CommentDialog
          text={text.dialogs.approve}
          dialogs={text.dialogs}
          onClose={close}
          onConfirm={(comment) => act(() => store.approveAs(sop.id, user.id, comment, approvalSnapshot), text.messages.approved)}
        />
      )}
      {dialog === 'returnApprover' && (
        <CommentDialog
          text={text.dialogs.return}
          dialogs={text.dialogs}
          required
          onClose={close}
          onConfirm={(comment) => act(() => store.returnAsApprover(sop.id, user.id, comment, approvalSnapshot), text.messages.returned)}
        />
      )}
      <ConfirmDialog
        open={dialog === 'publish'}
        title={text.dialogs.publish.title.replace('{title}', sop.title)}
        description={text.dialogs.publish.description.replace('{department}', department)}
        cancelLabel={text.dialogs.cancel}
        confirmLabel={text.dialogs.publish.confirm}
        onConfirm={() => act(() => store.publishAs(sop.id, user.id, approvalSnapshot), text.messages.published)}
        onCancel={close}
      />
    </>
  )
}
