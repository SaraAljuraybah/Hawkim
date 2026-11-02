import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SopWorkflowContent } from '../../content/types'
import { internalReviewEn } from '../../content/internalReview.en'
import type { Sop } from '../../data/mock/types'
import { addableReviewers, hasHomeFinished, homeReviewers } from '../../lib/internalReview'
import { WORKING_DAY_DEADLINES_ACTIVE } from '../../lib/deadlinePolicy'
import { REVIEW_DURATION_CONFIRM_ABOVE, REVIEW_DURATION_MAX, REVIEW_DURATION_MIN, ReviewerOrderError } from '../../lib/internalReviewStatus'
import { REVIEW_NOTE_EDITOR_MAX, prepareReviewSubmission } from '../../lib/reviewSubmission'
import { useDepartments } from '../../state/departmentsContext'
import type { SubmitOptions } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { FormDialog } from '../ui/FormDialog'
import { PeoplePicker } from '../ui/PeoplePicker'
import { SelectField } from '../ui/SelectField'
import { TextAreaField } from '../ui/TextAreaField'
import { TextField } from '../ui/TextField'

interface SubmitDialogProps {
  sop: Sop
  content: SopWorkflowContent['dialogs']
  /** Saves the request; if it throws, the dialog stays open and says so. */
  onSubmit: (options: SubmitOptions) => void | Promise<void>
  onClose: () => void
  /** 'add': the current version to more reviewers in its open (or settled) review; 'version': a new version to the reviewers chosen. */
  mode?: 'submit' | 'add' | 'version'
}

/**
 * Sends eligible home-department reviewers the same optional review duration, in working days
 * (lib/deadlinePolicy.ts). There's no response date to choose: the server sets it for each request.
 */
export function SubmitDialog({ sop, content, onSubmit, onClose, mode = 'submit' }: SubmitDialogProps) {
  const text = internalReviewEn.submit
  const fields = content.submit
  const { activeUsers } = useUsers()
  const { departments } = useDepartments()
  const department = departments.find((item) => item.id === sop.departmentId)
  const environment = { users: activeUsers, departments }
  const departmentName = department?.name ?? sop.departmentId
  // The first send of a version: the SOP's department only. Adding: reviewers not yet asked, or whose latest
  // request was declined, withdrawn or removed (an expired one is sent again instead), from any department
  // once a reviewer from the SOP's department has finished this version.
  const options = mode === 'add' ? addableReviewers(sop, environment) : homeReviewers(sop, environment)
  const anyDepartment = mode === 'add' && hasHomeFinished(sop, activeUsers)
  const [reviewerIds, setReviewerIds] = useState<string[]>([])
  const [departmentFilter, setDepartmentFilter] = useState('')
  // People already picked stay in, so the filter never hides their chips.
  const shown = options.filter((user) => !departmentFilter || user.departmentId === departmentFilter || reviewerIds.includes(user.id))
  const [duration, setDuration] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [durationError, setDurationError] = useState('')
  const [confirmLong, setConfirmLong] = useState(false)
  const [noteError, setNoteError] = useState('')
  const [failed, setFailed] = useState(false)
  const [failedText, setFailedText] = useState('')
  const firstRef = useRef<HTMLInputElement>(null)
  const durationRef = useRef<HTMLInputElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  async function confirm() {
    const result = prepareReviewSubmission(reviewerIds, options.map((user) => user.id), duration, note)
    if ('error' in result && result.error === 'reviewers') {
      flushSync(() => setError(text.reviewerRequired))
      firstRef.current?.focus()
      return false
    }
    if ('error' in result && result.error === 'duration') {
      flushSync(() => setDurationError(text.durationInvalid))
      durationRef.current?.focus()
      return false
    }
    if ('error' in result) {
      flushSync(() => setNoteError(text.noteServiceLimit))
      noteRef.current?.focus()
      return false
    }
    // A long duration may be a typing mistake: the first press asks, the second sends.
    if ((result.options.reviewDurationDays ?? 0) > REVIEW_DURATION_CONFIRM_ABOVE && !confirmLong) {
      flushSync(() => setConfirmLong(true))
      durationRef.current?.focus()
      return false
    }
    try { await onSubmit(result.options) }
    catch (failure) {
      const order = failure instanceof ReviewerOrderError ? (failure.reason === 'first-send' ? text.firstSendHome : text.mustFinish).replace('{department}', departmentName) : ''
      flushSync(() => { setFailed(true); setFailedText(order) })
      return false
    }
  }
  return (
    <FormDialog open title={text.title} confirmLabel={confirmLong ? text.confirmLong : text.confirm} cancelLabel={content.cancel} onConfirm={confirm} onClose={onClose}>
      {mode === 'add' && <p className="text-sm text-text-gray">{text.addIntro.replace('{version}', sop.version)}</p>}
      {mode === 'version' && <p className="text-sm text-maroon">{text.versionIntro.replace('{version}', sop.version)}</p>}
      {failed && <p role="alert" className="text-sm text-status-rejected-fg">{failedText || fields.errors.submitFailed}</p>}
      <TextField name="reviewDivision" label={text.division}
        value={department?.divisionId || text.noDivision} readOnly />
      <TextField name="reviewDepartment" label={text.department}
        value={departmentName} readOnly />
      {anyDepartment && <SelectField name="reviewerDepartment" label={text.reviewerDepartment} value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}
        options={[{ value: '', label: text.allDepartments }, ...departments.filter((item) => !item.removedAt).map((item) => ({ value: item.id, label: item.name }))]} />}
      <PeoplePicker inputRef={firstRef} label={text.reviewers} hideLabel text={text.reviewerSearch}
        options={shown.map((user) => ({ id: user.id, name: user.name, ...(anyDepartment ? { description: departments.find((item) => item.id === user.departmentId)?.name } : {}) }))} value={reviewerIds}
        error={error || undefined} hint={!options.length ? text.noneEligible : mode === 'add' && !anyDepartment ? text.homeFirst.replace('{department}', departmentName) : undefined}
        onChange={(next) => { setReviewerIds(next); setError(''); setFailed(false) }} />
      <TextField ref={durationRef} name="reviewDurationDays" type="number" inputMode="numeric" min={REVIEW_DURATION_MIN} max={REVIEW_DURATION_MAX} step={1}
        label={WORKING_DAY_DEADLINES_ACTIVE ? text.durationWorkingDays : text.duration}
        hint={text.durationHelp} value={duration} error={durationError || undefined}
        onChange={(event) => { setDuration(event.target.value); setDurationError(''); setConfirmLong(false); setFailed(false) }} />
      {confirmLong && <p role="alert" className="text-sm text-maroon">{text.durationLong.replace('{count}', String(REVIEW_DURATION_CONFIRM_ABOVE))}</p>}
      <TextAreaField ref={noteRef} name="note" rows={3} label={fields.note.label}
        error={noteError || undefined} placeholder={fields.note.placeholder} maxLength={REVIEW_NOTE_EDITOR_MAX} resizable={false}
        counter={fields.note.counter.replace('{count}', String(note.length)).replace('{max}', String(REVIEW_NOTE_EDITOR_MAX))}
        value={note} onChange={(event) => { setNote(event.target.value); setNoteError(''); setFailed(false) }} />
    </FormDialog>
  )
}
