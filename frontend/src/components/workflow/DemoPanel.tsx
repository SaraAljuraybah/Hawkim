import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { FlaskConical } from 'lucide-react'
import { sopWorkflowEn } from '../../content/workflow.en'
import { workflowDemoEn } from '../../content/workflowDemo.en'
import { getUser } from '../../data/mock/users'
import type { ReviewRole, Sop } from '../../data/mock/types'
import { useSops } from '../../state/sopsContext'
import { Button } from '../ui/Button'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'

const COMMENT_MAX = 1000

interface DemoPanelProps {
  sop: Sop
  /** Shows a success message on the workflow page. */
  announce: (message: string) => void
}

/**
 * DEVELOPMENT ONLY: simulates the reviewer's and approver's actions until their
 * screens exist. Loaded only when import.meta.env.DEV is true (see SopWorkflowPage),
 * so it is not part of the production build. Each button uses the same store
 * actions the real screens will use; the actor is the assigned reviewer or approver.
 */
export default function DemoPanel({ sop, announce }: DemoPanelProps) {
  const content = workflowDemoEn
  const roles = sopWorkflowEn.roles
  const store = useSops()
  const [commentRole, setCommentRole] = useState<ReviewRole | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string>()
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  function openComment(role: ReviewRole, trigger: HTMLElement) {
    triggerRef.current = trigger
    setComment('')
    setError(undefined)
    setCommentRole(role)
  }

  function closeComment() {
    setCommentRole(null)
    requestAnimationFrame(() => {
      if (triggerRef.current?.isConnected) triggerRef.current.focus()
    })
  }

  // Temporary: acts as the first pending reviewer/approver (per-person controls come later).
  const firstPending = (role: ReviewRole) =>
    (role === 'reviewer' ? sop.reviewers : sop.approvers).find((p) => p.decision === 'pending')?.userId ?? ''
  const actor = getUser(commentRole ? firstPending(commentRole) : undefined)
  const buttons =
    sop.status === 'in-review' ? (
      <>
        <Button size="sm" variant="secondary" onClick={(event) => openComment('reviewer', event.currentTarget)}>
          {content.buttons.reviewerReturn}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            store.completeReview(sop.id, firstPending('reviewer'))
            announce(content.messages.forwarded)
          }}
        >
          {content.buttons.reviewerForward}
        </Button>
      </>
    ) : sop.status === 'in-approval' ? (
      <>
        <Button size="sm" variant="secondary" onClick={(event) => openComment('approver', event.currentTarget)}>
          {content.buttons.approverReturn}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            store.approveAs(sop.id, firstPending('approver'))
            announce(content.messages.approved)
          }}
        >
          {content.buttons.approverApprove}
        </Button>
      </>
    ) : sop.status === 'approved' ? (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          store.publishAs(sop.id, sop.approvers[0]?.userId ?? '')
          announce(content.messages.published)
        }}
      >
        {content.buttons.approverPublish}
      </Button>
    ) : null

  return (
    <details className="mt-6 rounded-xl border-2 border-dashed border-text-gray/40 bg-white p-5 sm:p-6">
      <summary className="flex cursor-pointer items-center gap-2 rounded-sm text-base font-semibold text-maroon">
        <FlaskConical aria-hidden="true" className="size-5" strokeWidth={1.75} />
        {content.title}
      </summary>
      <p className="mt-3 text-sm text-text-gray">{content.note}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {buttons ?? <p className="text-sm text-text-gray">{content.noActions}</p>}
      </div>

      {commentRole && (
        <FormDialog
          open
          title={content.commentDialog.title}
          description={content.commentDialog.description
            .replace('{name}', actor?.name ?? '')
            .replace('{role}', commentRole === 'approver' ? roles.approver : roles.reviewer)}
          confirmLabel={content.commentDialog.confirm}
          cancelLabel={content.commentDialog.cancel}
          onClose={closeComment}
          onConfirm={() => {
            if (!comment.trim()) {
              flushSync(() => setError(content.commentDialog.required))
              commentRef.current?.focus()
              return false
            }
            if (commentRole === 'reviewer') store.returnAsReviewer(sop.id, firstPending('reviewer'), comment.trim())
            else store.returnAsApprover(sop.id, firstPending('approver'), comment.trim())
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
