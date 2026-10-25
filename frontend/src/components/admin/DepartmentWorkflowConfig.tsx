import { useState } from 'react'
import { reviewFlowEn } from '../../content/reviewFlow.en'
import type { Department } from '../../data/mock/types'
import { useDepartments } from '../../state/departmentsContext'
import { useCurrentUser } from '../../state/sessionContext'
import { useUsers } from '../../state/usersContext'
import { Button } from '../ui/Button'
import { FormDialog } from '../ui/FormDialog'
import { SelectField } from '../ui/SelectField'
import { TextField } from '../ui/TextField'

/** Explicit configuration; no division or controller is inferred from names or permissions alone. */
export function DepartmentWorkflowConfig({ department }: { department: Department }) {
  const text = reviewFlowEn.workflowConfig
  const { configureWorkflow } = useDepartments()
  const { users, activeUsers, nameOf } = useUsers()
  const actor = useCurrentUser()
  const [open, setOpen] = useState(false)
  const [divisionId, setDivisionId] = useState(department.divisionId ?? '')
  const [controllerId, setControllerId] = useState(department.qualityControllerId ?? '')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  return <section className="mt-6 rounded-xl border border-beige bg-white p-5 sm:p-6">
    <h2 className="text-lg">{text.title}</h2>
    <p className="mt-2 text-sm text-text-gray">{text.help}</p>
    <dl className="mt-4 space-y-2 text-sm text-maroon">
      <div><dt className="font-semibold">{text.division}</dt><dd>{department.divisionId ?? text.unconfigured}</dd></div>
      <div><dt className="font-semibold">{text.controller}</dt><dd>{department.qualityControllerId ? nameOf(department.qualityControllerId) : text.unconfigured}</dd></div>
    </dl>
    <Button className="mt-4" variant="secondary" onClick={() => { setDivisionId(department.divisionId ?? ''); setControllerId(department.qualityControllerId ?? ''); setError(''); setOpen(true) }}>{text.open}</Button>
    <p role="status" className="mt-2 text-sm text-maroon">{message}</p>
    {open && <FormDialog open title={text.title} confirmLabel={text.save} cancelLabel={reviewFlowEn.cancel} onClose={() => setOpen(false)} onConfirm={() => {
      try { configureWorkflow(department.id, { divisionId, qualityControllerId: controllerId }, { actorId: actor.id, users }); setMessage(text.saved) }
      catch (reason) { setError(reason instanceof Error ? reason.message : text.unconfigured); return false }
    }}>
      {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
      <TextField name="divisionId" label={text.division} hint={text.divisionHint} maxLength={80} value={divisionId} onChange={(event) => setDivisionId(event.target.value)} />
      <SelectField name="qualityController" label={text.controller} value={controllerId} options={[{ value: '', label: text.unconfigured }, ...activeUsers.filter((u) => !u.permissions.includes('admin') && u.permissions.includes('approver')).map((u) => ({ value: u.id, label: u.name }))]} onChange={(event) => setControllerId(event.target.value)} />
    </FormDialog>}
  </section>
}
