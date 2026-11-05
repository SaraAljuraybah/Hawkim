import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { approvalEn } from '../../content/approval.en'
import type { Sop } from '../../data/mock/types'
import { approvalReadiness, eligibleApprovers, qualityDepartment, type ApprovalBlocker, type ApprovalSubmissionOptions } from '../../lib/approval'
import { refusesChoice } from '../../lib/reviewDepartment'
import { departmentsInDivision, divisionOptions, NO_DIVISION } from '../../lib/userAdmin'
import { SUBMIT_COMMENT_MAX } from '../../lib/workflow'
import { useDepartments } from '../../state/departmentsContext'
import { useCurrentUser } from '../../state/sessionContext'
import { useUsers } from '../../state/usersContext'
import { FormDialog } from '../ui/FormDialog'
import { PeoplePicker } from '../ui/PeoplePicker'
import { SelectCombobox } from '../ui/SelectCombobox'
import { TextAreaField } from '../ui/TextAreaField'

interface SubmitForApprovalDialogProps {
  sop: Sop
  onSubmit: (options: ApprovalSubmissionOptions) => void
  onClose: () => void
}

/** The dialog's text for a reason the submit step refuses (the approver and the comment have their own field errors). */
function blockerText(code: ApprovalBlocker): string | undefined {
  return code in approvalEn.blockers ? approvalEn.blockers[code as keyof typeof approvalEn.blockers] : undefined
}

/**
 * Sends this version and review round to one Approver of the Quality department, chosen by the main
 * Author, with an optional comment. Laid out like Submit for Review: Division and Department show the
 * Quality department and can't be changed (lib/reviewDepartment.ts refusesChoice).
 */
export function SubmitForApprovalDialog({ sop, onSubmit, onClose }: SubmitForApprovalDialogProps) {
  const text = approvalEn.dialog
  const user = useCurrentUser()
  const { users } = useUsers()
  const { departments } = useDepartments()
  const environment = { users, departments }
  // Keep the opening snapshot: a stale dialog cannot submit a later version or round.
  const [snapshot] = useState(() => ({ version: sop.version, internalReviewRoundId: sop.internalReviewRounds?.at(-1)?.id ?? '' }))
  const quality = qualityDepartment(departments)
  const qualityName = quality?.name ?? ''
  const lockMessage = text.qualityOnly.replace('{department}', qualityName)
  const ownDivision = quality?.divisionId || NO_DIVISION
  const choosable = departments.filter((item) => !item.removedAt)
  const approvers = eligibleApprovers(sop, environment)
  const [approverIds, setApproverIds] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [divisionError, setDivisionError] = useState('')
  const [departmentError, setDepartmentError] = useState('')
  const [approverError, setApproverError] = useState('')
  const [noteError, setNoteError] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const errorRef = useRef<HTMLDivElement>(null)
  const approverRef = useRef<HTMLInputElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  function showErrors(messages: string[]) {
    flushSync(() => setErrors(messages))
    errorRef.current?.focus()
    return false
  }

  function confirm() {
    const options: ApprovalSubmissionOptions = { ...snapshot, approverId: approverIds[0] ?? '', note }
    const current = approvalReadiness(sop, user.id, environment, options)
    if (current.blockers.includes('approver-required')) {
      flushSync(() => setApproverError(text.approverRequired))
      approverRef.current?.focus()
      return false
    }
    if (current.blockers.includes('note-too-long')) {
      flushSync(() => setNoteError(text.noteTooLong.replace('{max}', String(SUBMIT_COMMENT_MAX))))
      noteRef.current?.focus()
      return false
    }
    if (!current.ready) {
      const messages = current.blockers.map(blockerText).filter((message): message is string => !!message)
      return showErrors(messages.length ? messages : [text.failed])
    }
    try {
      onSubmit(options)
    } catch (error) {
      return showErrors([error instanceof Error ? error.message : text.failed])
    }
  }

  return (
    <FormDialog open title={text.title} confirmLabel={text.submit} cancelLabel={text.cancel} onConfirm={confirm} onClose={onClose}>
      {errors.length > 0 && (
        <div ref={errorRef} role="alert" tabIndex={-1} className="rounded-lg border border-status-rejected-fg/20 bg-status-rejected-bg p-3 text-sm text-status-rejected-fg">
          <ul className="list-disc space-y-1 pl-4">{errors.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}
      {/* Both lists can be opened, but only the Quality department's division and department can be chosen. */}
      <SelectCombobox name="approvalDivision" label={text.division} placeholder={text.divisionPicker.placeholder}
        options={divisionOptions(choosable).map((item) => ({ value: item, label: item === NO_DIVISION ? text.noDivision : item }))}
        value={ownDivision} error={divisionError || undefined} toggleLabel={text.divisionPicker.toggle} noMatchesText={text.divisionPicker.noMatches}
        required requiredMark onChange={(next) => setDivisionError(refusesChoice(true, ownDivision, next) ? lockMessage : '')} />
      <SelectCombobox name="approvalDepartment" label={text.department} placeholder={text.departmentPicker.placeholder}
        options={departmentsInDivision(choosable, ownDivision).map((item) => ({ value: item.id, label: item.name }))}
        value={quality?.id ?? ''} error={departmentError || undefined} toggleLabel={text.departmentPicker.toggle} noMatchesText={text.departmentPicker.noMatches}
        required requiredMark onChange={(next) => setDepartmentError(refusesChoice(true, quality?.id ?? '', next) ? lockMessage : '')} />
      <PeoplePicker inputRef={approverRef} label={text.approvers} text={text.approverSearch}
        options={approvers.map((person) => ({ id: person.id, name: person.name }))} value={approverIds}
        error={approverError || undefined} hint={approvers.length ? undefined : text.noApprovers.replace('{department}', qualityName)} required requiredMark
        // One approver: choosing another replaces the first.
        onChange={(next) => { setApproverIds(next.slice(-1)); setApproverError(''); setErrors([]) }} />
      <TextAreaField ref={noteRef} name="note" rows={3} label={text.note.label} placeholder={text.note.placeholder}
        error={noteError || undefined} maxLength={SUBMIT_COMMENT_MAX} resizable={false}
        counter={text.note.counter.replace('{count}', String(note.length)).replace('{max}', String(SUBMIT_COMMENT_MAX))}
        value={note} onChange={(event) => { setNote(event.target.value); setNoteError(''); setErrors([]) }} />
    </FormDialog>
  )
}
