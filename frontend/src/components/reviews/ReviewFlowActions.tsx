import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { reviewFlowEn as text } from '../../content/reviewFlow.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { Sop } from '../../data/mock/types'
import { currentDepartmentReview, departmentsForScope, eligibleReviewers, keepsRoundDeadline, qualityController, type ReviewAction } from '../../lib/reviewFlow'
import { formatDate } from '../../lib/format'
import { dueDateRange, parseDueDate } from '../../lib/workflow'
import { useDepartments } from '../../state/departmentsContext'
import { useSops } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { Button } from '../ui/Button'
import { FormDialog } from '../ui/FormDialog'
import { SelectField } from '../ui/SelectField'
import { TextAreaField } from '../ui/TextAreaField'
import { ReviewDueDateField } from '../workflow/ReviewDueDateField'

interface Props { sop: Sop; onComplete: (message: string) => void }
/** Only mounted for the active reviewer. Workflow transitions revalidate every selection. */
export function ReviewFlowActions({ sop, onComplete }: Props) {
  const flow = sop.reviewFlow!
  const store = useSops()
  const { users } = useUsers()
  const { departments } = useDepartments()
  const [dialog, setDialog] = useState<'forward' | 'complete' | 'return-review' | 'return-author' | 'departments' | null>(null)
  const [selected, setSelected] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dateError, setDateError] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [choices, setChoices] = useState<Record<string, string>>({})
  const triggerRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLSelectElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const stage = flow.stage
  const representative = stage.endsWith('representative')
  const forward = stage === 'reviewer-1' || representative
  const complete = stage === 'reviewer-2' || stage.endsWith('-reviewer')
  const decision = stage.endsWith('-decision')
  const scope = stage.startsWith('same-division') ? 'same-division' : 'cross-division'
  const departmentReview = currentDepartmentReview(sop)
  const departmentId = stage === 'reviewer-1' ? sop.departmentId : departmentReview?.departmentId ?? ''
  const retainedId = stage === 'reviewer-1' ? flow.reviewer2Id : departmentReview?.reviewerId
  // The chosen reviewer already has a deadline in this review round: they keep it (no new date).
  const keepsDeadline = !!selected && keepsRoundDeadline(sop, selected)
  const options = eligibleReviewers(sop, departmentId, users, sop.reviewers.filter((p) => p.userId !== retainedId).map((p) => p.userId)).filter((u) => !retainedId || u.id === retainedId)
  const candidates = departmentsForScope(sop, scope, departments)
  const controller = qualityController(sop, { users, departments })
  const source = departments.find((d) => d.id === sop.departmentId)
  function open(next: NonNullable<typeof dialog>, trigger: HTMLElement) {
    triggerRef.current = trigger
    setError(''); setSelected(''); setComment(''); setDueDate(''); setDateError(''); setChoices({}); setDialog(next)
  }
  function close() {
    setDialog(null)
    requestAnimationFrame(() => { if (triggerRef.current?.isConnected) triggerRef.current.focus(); else panelRef.current?.focus() })
  }
  function act(action: ReviewAction) {
    try { store.reviewAction(sop.id, action); setDialog(null); onComplete(text.updated) }
    catch (reason) { setError(reason instanceof Error ? reason.message : text.selectRequired); return false }
  }
  function confirm() {
    if (dialog === 'forward') {
      if (!selected) { setError(text.selectRequired); fieldRef.current?.focus(); return false }
      if (!parseDueDate(dueDate).valid) {
        const { min } = dueDateRange()
        flushSync(() => setDateError(sopWorkflowEn.dialogs.submit.errors.dateInvalid.replace('{min}', formatDate(min))))
        dateRef.current?.focus()
        return false
      }
      return act({ type: 'forward', reviewerId: selected, dueDate: dueDate || undefined, text: comment })
    }
    if (dialog === 'complete') return act({ type: 'complete', text: comment })
    if (dialog === 'return-author' || dialog === 'return-review') {
      if (!comment.trim()) { setError(text.commentRequired); commentRef.current?.focus(); return false }
      return act({ type: dialog, text: comment })
    }
    const assignments = Object.entries(choices).map(([departmentId, representativeId]) => ({ departmentId, representativeId }))
    if (!assignments.length || assignments.some((a) => !a.representativeId)) { setError(text.selectionRequired); return false }
    return act({ type: 'department-review', scope, assignments })
  }
  const title = dialog === 'forward' ? text.forward : dialog === 'complete' ? text.complete : dialog === 'return-review' ? text.returnReview : dialog === 'return-author' ? text.returnAuthor : text.selectDepartments
  return (
    <div ref={panelRef} tabIndex={-1} className="space-y-4 focus:outline-none">
      {decision && <p className="text-sm text-text-gray">{text.scopePending}</p>}
      {decision && !source?.divisionId && <p role="status" className="text-sm text-status-rejected-fg">{text.divisionMissing}</p>}
      {stage === 'quality-routing' && <p role="status" className="text-sm text-maroon">{controller ? text.qualityAssigned + ': ' + controller.name : text.qualityMissing}</p>}
      {!dialog && error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {forward && <Button onClick={(event) => open('forward', event.currentTarget)}>{text.forward}</Button>}
        {complete && <Button onClick={(event) => open('complete', event.currentTarget)}>{text.complete}</Button>}
        {stage === 'reviewer-2' && <Button variant="secondary" onClick={(event) => open('return-review', event.currentTarget)}>{text.returnReview}</Button>}
        {decision && <>
          <Button onClick={(event) => open('departments', event.currentTarget)}>{text.departmentReview}</Button>
          <Button variant="secondary" onClick={() => act({ type: 'skip', scope })}>{text.skip}</Button>
        </>}
        {stage === 'quality-routing' && <Button disabled={!controller} onClick={() => act({ type: 'quality' })}>{text.routeQuality}</Button>}
        <Button variant="secondary" onClick={(event) => open('return-author', event.currentTarget)}>{text.returnAuthor}</Button>
      </div>
      {dialog && <FormDialog open title={title} description={dialog === 'return-review' ? text.returnReviewHelp : dialog === 'departments' ? text.departmentsHelp : undefined}
        confirmLabel={text.confirm} cancelLabel={text.cancel} onConfirm={confirm} onClose={close}>
        {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
        {dialog === 'forward' && <>
          {options.length === 0 && <p role="status" className="text-sm text-status-rejected-fg">{text.noneEligible}</p>}
          <SelectField ref={fieldRef} name="nextReviewer" label={representative ? text.assignedReviewer : text.reviewer2} placeholder={text.choose} options={options.map((u) => ({ value: u.id, label: u.name }))} value={selected} onChange={(event) => { setSelected(event.target.value); setError('') }} />
          {keepsDeadline && <p className="text-sm text-text-gray">{text.retainedDeadline}</p>}
          <ReviewDueDateField ref={dateRef} name="nextDueDate" text={sopWorkflowEn.dialogs.submit.reviewDate} disabled={keepsDeadline}
            value={dueDate} error={dateError} onChange={(value) => { setDueDate(value); setDateError('') }} />
        </>}
        {dialog === 'departments' ? <div className="space-y-4">
          <p className="text-sm text-text-gray">{text.unknownDivisions}</p>
          {candidates.length === 0 && <p role="status" className="text-sm text-status-rejected-fg">{text.noDepartments}</p>}
          {candidates.map((department) => {
            const selectedDepartment = Object.hasOwn(choices, department.id)
            const reviewers = eligibleReviewers(sop, department.id, users, sop.reviewers.map((p) => p.userId))
            return <div key={department.id} className="rounded-lg border border-beige p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-maroon">
                <input type="checkbox" className="size-4 accent-maroon" checked={selectedDepartment} onChange={(event) => setChoices((previous) => { const next = { ...previous }; if (event.target.checked) next[department.id] = ''; else delete next[department.id]; return next })} />
                {department.name}
              </label>
              {selectedDepartment && <SelectField className="mt-3" name={'representative-' + department.id} label={text.representative} placeholder={text.choose} value={choices[department.id]} options={reviewers.map((u) => ({ value: u.id, label: u.name }))} onChange={(event) => setChoices({ ...choices, [department.id]: event.target.value })} />}
            </div>
          })}
        </div> : <TextAreaField ref={commentRef} name="reviewComment" rows={4} label={dialog.startsWith('return-') ? text.requiredComment : text.comment} maxLength={1000} value={comment} onChange={(event) => { setComment(event.target.value); setError('') }} />}
      </FormDialog>}
    </div>
  )
}
