import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ReviewCommentDialog, ReviewPageContent } from '../../content/types'
import type { Sop } from '../../data/mock/types'
import { personOption } from '../../lib/people'
import { canBeRoutedTo } from '../../lib/workflow'
import { useDepartments } from '../../state/departmentsContext'
import { useUsers } from '../../state/usersContext'
import { FormDialog } from '../ui/FormDialog'
import { PeoplePicker } from '../ui/PeoplePicker'
import { TextAreaField } from '../ui/TextAreaField'

/** Comments and notes are limited like the other workflow comments. */
export const COMMENT_MAX = 1000

interface CommentDialogProps {
  text: ReviewCommentDialog & { required?: string }
  dialogs: ReviewPageContent['dialogs']
  /** When true, an empty comment is refused with `text.required`. */
  required?: boolean
  onConfirm: (comment: string) => void
  onClose: () => void
}

/** Complete review / Approve (optional comment) or Return to author (required comment). */
export function CommentDialog({ text, dialogs, required = false, onConfirm, onClose }: CommentDialogProps) {
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string>()
  const commentRef = useRef<HTMLTextAreaElement>(null)

  return (
    <FormDialog
      open
      title={text.title}
      description={text.description}
      confirmLabel={text.confirm}
      cancelLabel={dialogs.cancel}
      onClose={onClose}
      onConfirm={() => {
        if (required && !comment.trim()) {
          flushSync(() => setError(text.required))
          commentRef.current?.focus()
          return false
        }
        onConfirm(comment.trim())
      }}
    >
      <TextAreaField
        ref={commentRef}
        name="comment"
        rows={4}
        label={text.label}
        maxLength={COMMENT_MAX}
        counter={dialogs.counter.replace('{count}', String(comment.length)).replace('{max}', String(COMMENT_MAX))}
        value={comment}
        error={error}
        onChange={(event) => {
          setComment(event.target.value)
          if (error) setError(undefined)
        }}
      />
    </FormDialog>
  )
}

interface RouteDialogProps {
  sop: Sop
  dialogs: ReviewPageContent['dialogs']
  onConfirm: (reviewerId: string, note: string) => void
  onClose: () => void
}

/**
 * Route to another department (PBI 23): pick ONE reviewer from a department other
 * than the SOP's (never someone already on the SOP), with an optional note.
 */
export function RouteDialog({ sop, dialogs, onConfirm, onClose }: RouteDialogProps) {
  const text = dialogs.route
  const { activeUsers } = useUsers()
  const { nameOf: departmentName } = useDepartments()
  const [selected, setSelected] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  const inputRef = useRef<HTMLInputElement>(null)

  const options = activeUsers
    .filter((user) => canBeRoutedTo(sop, user))
    .map((user) => personOption(user, departmentName))

  return (
    <FormDialog
      open
      title={text.title}
      description={text.description}
      confirmLabel={text.confirm}
      cancelLabel={dialogs.cancel}
      onClose={onClose}
      onConfirm={() => {
        if (options.length === 0) return
        if (selected.length === 0) {
          flushSync(() => setError(text.required))
          inputRef.current?.focus()
          return false
        }
        onConfirm(selected[0], note.trim())
      }}
    >
      {options.length === 0 ? (
        <p className="text-sm text-text-gray">{text.noneEligible}</p>
      ) : (
        <>
          <PeoplePicker
            label={text.pickerLabel}
            hint={text.pickerHint.replace('{department}', departmentName(sop.departmentId))}
            error={error}
            options={options}
            value={selected}
            // One reviewer at a time: a new choice replaces the previous one.
            onChange={(next) => {
              setSelected(next.slice(-1))
              if (error) setError(undefined)
            }}
            inputRef={inputRef}
          />
          <TextAreaField
            name="note"
            rows={3}
            label={text.noteLabel}
            maxLength={COMMENT_MAX}
            counter={dialogs.counter.replace('{count}', String(note.length)).replace('{max}', String(COMMENT_MAX))}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-5"
          />
        </>
      )}
    </FormDialog>
  )
}
