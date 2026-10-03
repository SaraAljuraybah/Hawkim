import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { FlaskConical } from 'lucide-react'
import { sopWorkflowEn } from '../../content/workflow.en'
import { workflowDemoEn } from '../../content/workflowDemo.en'
import { getUser } from '../../data/mock/users'
import type { ReviewRole, Sop } from '../../data/mock/types'
import { currentDueAt } from '../../lib/workflow'
import { useSops } from '../../state/sopsContext'
import { Button } from '../ui/Button'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'

const COMMENT_MAX = 1000
/** "Move the clock forward": due dates move this many days earlier. */
const CLOCK_STEP_DAYS = 3

interface DemoPanelProps {
  sop: Sop
  /** Shows a success message on the workflow page. */
  announce: (message: string) => void
}

/** The person returning the SOP with a comment. */
interface Returner {
  userId: string
  role: ReviewRole
}

/**
 * DEVELOPMENT ONLY: simulates each reviewer's and approver's actions until their
 * screens exist. Loaded only when import.meta.env.DEV is true (see SopWorkflowPage),
 * so it is not part of the production build. Each button uses the same store
 * actions the real screens will use, acting as that person.
 */
export default function DemoPanel({ sop, announce }: DemoPanelProps) {
  const content = workflowDemoEn
  const roles = sopWorkflowEn.roles
  const store = useSops()
  const [returner, setReturner] = useState<Returner | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string>()
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const nameOf = (userId: string) => getUser(userId)?.name ?? ''
  const label = (template: string, userId: string) => template.replace('{name}', nameOf(userId))

  function openComment(next: Returner, trigger: HTMLElement) {
    triggerRef.current = trigger
    setComment('')
    setError(undefined)
    setReturner(next)
  }

  function closeComment() {
    setReturner(null)
    requestAnimationFrame(() => {
      if (triggerRef.current?.isConnected) triggerRef.current.focus()
    })
  }

  const pendingReviewers = sop.status === 'in-review' ? sop.reviewers.filter((p) => p.decision === 'pending') : []
  const pendingApprovers = sop.status === 'in-approval' ? sop.approvers.filter((p) => p.decision === 'pending') : []
  const publishers = sop.status === 'approved' ? sop.approvers : []
  // The clock only matters when the open stage has a due date.
  const dueDatesOpen = !!currentDueAt(sop)

  const buttons = [
    ...pendingReviewers.flatMap(({ userId }) => [
      <Button
        key={`complete-${userId}`}
        size="sm"
        variant="secondary"
        onClick={() => {
          store.completeReview(sop.id, userId)
          announce(label(content.messages.reviewCompleted, userId))
        }}
      >
        {label(content.buttons.completeReview, userId)}
      </Button>,
      <Button
        key={`return-${userId}`}
        size="sm"
        variant="secondary"
        onClick={(event) => openComment({ userId, role: 'reviewer' }, event.currentTarget)}
      >
        {label(content.buttons.returnWithComment, userId)}
      </Button>,
    ]),
    ...pendingApprovers.flatMap(({ userId }) => [
      <Button
        key={`approve-${userId}`}
        size="sm"
        variant="secondary"
        onClick={() => {
          store.approveAs(sop.id, userId)
          announce(label(content.messages.approved, userId))
        }}
      >
        {label(content.buttons.approve, userId)}
      </Button>,
      <Button
        key={`return-${userId}`}
        size="sm"
        variant="secondary"
        onClick={(event) => openComment({ userId, role: 'approver' }, event.currentTarget)}
      >
        {label(content.buttons.returnWithComment, userId)}
      </Button>,
    ]),
    ...publishers.map(({ userId }) => (
      <Button
        key={`publish-${userId}`}
        size="sm"
        variant="secondary"
        onClick={() => {
          store.publishAs(sop.id, userId)
          announce(content.messages.published)
        }}
      >
        {label(content.buttons.publish, userId)}
      </Button>
    )),
  ]

  return (
    <details className="mt-6 rounded-xl border-2 border-dashed border-text-gray/40 bg-white p-5 sm:p-6">
      <summary className="flex cursor-pointer items-center gap-2 rounded-sm text-base font-semibold text-maroon">
        <FlaskConical aria-hidden="true" className="size-5" strokeWidth={1.75} />
        {content.title}
      </summary>
      <p className="mt-3 text-sm text-text-gray">{content.note}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {buttons.length > 0 ? buttons : <p className="text-sm text-text-gray">{content.noActions}</p>}
      </div>
      {dueDatesOpen && (
        <div className="mt-4 border-t border-beige pt-4">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              store.shiftDueDates(sop.id, CLOCK_STEP_DAYS)
              announce(content.messages.clockForward)
            }}
          >
            {content.buttons.clockForward}
          </Button>
        </div>
      )}

      {returner && (
        <FormDialog
          open
          title={content.commentDialog.title}
          description={content.commentDialog.description
            .replace('{name}', nameOf(returner.userId))
            .replace('{role}', returner.role === 'approver' ? roles.approver : roles.reviewer)}
          confirmLabel={content.commentDialog.confirm}
          cancelLabel={content.commentDialog.cancel}
          onClose={closeComment}
          onConfirm={() => {
            if (!comment.trim()) {
              flushSync(() => setError(content.commentDialog.required))
              commentRef.current?.focus()
              return false
            }
            if (returner.role === 'reviewer') store.returnAsReviewer(sop.id, returner.userId, comment.trim())
            else store.returnAsApprover(sop.id, returner.userId, comment.trim())
            announce(content.messages.returned)
          }}
        >
          <TextAreaField
            ref={commentRef}
            name="comment"
            rows={4}
            label={content.commentDialog.label}
            placeholder={content.commentDialog.placeholder}
            maxLength={COMMENT_MAX}
            value={comment}
            error={error}
            onChange={(event) => setComment(event.target.value)}
          />
        </FormDialog>
      )}
    </details>
  )
}
