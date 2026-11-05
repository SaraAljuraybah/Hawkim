import { Fragment, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, ChevronRight, Eye, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'
import { IconButton } from '../../components/ui/IconButton'
import { FormDialog } from '../../components/ui/FormDialog'
import { PageLoading } from '../../components/ui/PageLoading'
import { DepartmentBadge } from '../../components/admin/DepartmentBadge'
import { DivisionForm, DivisionPreview } from '../../components/admin/DivisionDialogs'
import { DeleteDepartmentDialog } from '../../components/admin/DeleteDepartmentDialog'
import { organizationAdminEn as text } from '../../content/organizationAdmin.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useOrganizationManagement } from '../../hooks/useOrganizationManagement'
import { hierarchyRows } from '../../lib/organizationAdmin'
import { adminDepartmentEditPath, adminDepartmentPath } from '../../lib/routes'
import { deleteDivision, type DivisionRecord, type ManagedDepartment, type ManagementSnapshot } from '../../services/organizationAdmin'

export interface AdminDepartmentsLocationState { removed?: string }

export function AdminDepartmentsPage() {
  useDocumentTitle(text.title)
  const { data, error, refresh } = useOrganizationManagement()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<DivisionRecord | null | undefined>()
  const [preview, setPreview] = useState<DivisionRecord>()
  const [deleting, setDeleting] = useState<DivisionRecord>()
  const [department, setDepartment] = useState<ManagedDepartment>()
  const notice = (useLocation().state as AdminDepartmentsLocationState | null)?.removed
  const [feedback, setFeedback] = useState(notice ?? '')
  const [actionError, setActionError] = useState('')
  const trigger = useRef<HTMLElement | null>(null)
  const open = (action: () => void) => { trigger.current = document.activeElement as HTMLElement; setFeedback(''); setActionError(''); action() }
  const close = () => { setEditing(undefined); setPreview(undefined); setDeleting(undefined); setDepartment(undefined); trigger.current?.focus() }
  return <>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl tracking-tight sm:text-3xl">{text.title}</h1><p className="mt-2 text-text-gray">{text.subtitle}</p></div>
      <Button onClick={() => open(() => setEditing(null))}><Plus className="size-4" aria-hidden="true" />{text.addDivision}</Button></div>
    <TextField className="mt-8 max-w-md" name="organizationSearch" type="search" label={text.search} placeholder={text.searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} />
    <p role="status" className="mt-4 text-sm text-status-approved-fg">{feedback}</p>
    {error ? <div role="alert"><p>{text.loadFailed}</p><Button variant="secondary" onClick={() => void refresh()}>{text.retry}</Button></div>
      : !data ? <PageLoading /> : <HierarchyTable snapshot={data} query={query}
        onPreview={(row) => open(() => setPreview(row))} onEdit={(row) => open(() => setEditing(row))}
        onDeleteDivision={(row) => open(() => setDeleting(row))} onDeleteDepartment={(row) => open(() => setDepartment(row))} />}
    {editing !== undefined && <DivisionForm onSaved={() => setFeedback(text.saved)} division={editing ?? undefined} onClose={() => { close(); void refresh() }} />}
    {preview && <DivisionPreview division={preview} onClose={close} onEdit={() => { setPreview(undefined); setEditing(preview) }} />}
    {deleting && <FormDialog open title={text.deleteTitle.replace('{name}', deleting.name)} description={text.deleteDivisionText}
      confirmLabel={text.delete} cancelLabel={text.cancel} onClose={close} onConfirm={async () => {
        try { await deleteDivision(deleting); setFeedback(text.removed); void refresh() }
        catch (reason) { setActionError((reason as Error).message); void refresh(); return false }
      }}>{actionError && <p role="alert" className="text-sm text-status-rejected-fg">{actionError}</p>}</FormDialog>}
    {department && <DeleteDepartmentDialog department={department} onClose={close} onDeleted={() => { setFeedback(text.removed); void refresh() }} />}
  </>
}

export function HierarchyTable({ snapshot, query = '', onPreview, onEdit, onDeleteDivision, onDeleteDepartment }: {
  snapshot: ManagementSnapshot; query?: string; onPreview: (division: DivisionRecord) => void;
  onEdit: (division: DivisionRecord) => void; onDeleteDivision: (division: DivisionRecord) => void;
  onDeleteDepartment: (department: ManagedDepartment) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // While searching, matching divisions open automatically but can still be collapsed.
  const [collapsedInSearch, setCollapsedInSearch] = useState<Set<string>>(new Set())
  const searching = !!query.trim()
  const isOpen = (id: string) => searching ? !collapsedInSearch.has(id) : expanded.has(id)
  const toggle = (id: string) => {
    const update = (previous: Set<string>) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next }
    if (searching) setCollapsedInSearch(update); else setExpanded(update)
  }
  const rows = hierarchyRows(snapshot, query)
  const divisionIds = new Set(snapshot.divisions.map((division) => division.id))
  const unassigned = snapshot.departments.filter((row) => (!row.division_id || !divisionIds.has(row.division_id)) && row.name.toLowerCase().includes(query.trim().toLowerCase()))
  function child(row: ManagedDepartment) {
    return <tr key={row.id} className="border-t border-beige hover:bg-beige/20">
      <th scope="row" className="py-3 pr-4 pl-12 font-medium"><span className="flex items-center gap-3 border-l border-beige pl-5"><DepartmentBadge department={row} />
        <Link className="text-maroon underline-offset-2 hover:underline" to={adminDepartmentPath(row.id)}>{row.name}</Link></span></th>
      <td className="p-4 text-right tabular-nums">{row.employees}</td><td className="p-4 text-right tabular-nums">{row.sops}</td>
      <td className="p-3"><div className="flex justify-end gap-2"><IconButton label={`${text.edit} ${row.name}`} icon={Pencil} edit disabledReason={row.deletion_job_id ? text.cleanupPending : undefined} to={adminDepartmentEditPath(row.id)} />
        <IconButton label={`${row.deletion_job_id ? text.retryCleanup : text.delete} ${row.name}`} icon={Trash2} danger disabledReason={row.employees > 0 ? text.departmentBlocked : undefined} onClick={() => onDeleteDepartment(row)} /></div></td>
    </tr>
  }
  return <div className="mt-3 overflow-x-auto rounded-xl border border-beige bg-white">
    <table aria-label={text.title} className="w-full min-w-[600px] table-fixed text-left text-sm">
    {/* Fixed column widths, so expanding or searching never shifts the columns. */}
    <colgroup><col /><col className="w-32" /><col className="w-32" /><col className="w-40" /></colgroup><thead className="bg-beige/60 text-maroon"><tr>
      <th scope="col" className="p-4">{text.name}</th><th scope="col" className="p-4 text-right">{text.employees}</th><th scope="col" className="p-4 text-right">{text.sops}</th><th scope="col"><span className="sr-only">{text.edit}</span></th>
    </tr></thead><tbody>
      {rows.map(({ division, children, departmentCount, employees, sops }) => {
        const isExpanded = isOpen(division.id)
        return <Fragment key={division.id}><tr className="border-t border-beige">
          <th scope="row" className="p-4">
            {/* The chevron and the division name are one toggle. */}
            <button type="button" aria-expanded={isExpanded} aria-controls={`children-${division.id}`}
              className="group flex items-start gap-3 rounded text-left" onClick={() => toggle(division.id)}>
              <span aria-hidden="true" className="mt-0.5 rounded p-1 text-maroon group-hover:bg-beige">{isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span>
              <span><span className="block font-semibold text-maroon group-hover:underline">{division.name}</span>
                <span className="mt-1 block text-xs font-normal text-text-gray">{text.departments} ({departmentCount})</span></span>
            </button></th>
          <td className="p-4 text-right tabular-nums">{employees}</td><td className="p-4 text-right tabular-nums">{sops}</td>
          <td className="p-3"><div className="flex justify-end gap-2"><IconButton label={`${text.preview} ${division.name}`} icon={Eye} onClick={() => onPreview(division)} />
            <IconButton label={`${text.edit} ${division.name}`} icon={Pencil} edit onClick={() => onEdit(division)} />
            <IconButton label={`${text.delete} ${division.name}`} icon={Trash2} danger disabledReason={departmentCount ? text.divisionBlocked : undefined} onClick={() => onDeleteDivision(division)} /></div></td>
        </tr><tr id={`children-${division.id}`} hidden={!isExpanded}><td colSpan={4} className="border-t border-beige bg-beige/20 py-2 pr-3 pl-12"><div className="flex items-center justify-between gap-3"><span className="font-medium text-maroon">{text.departments}</span>
          {isExpanded && <Button to={`/admin/departments/new?division=${encodeURIComponent(division.id)}`}><Plus className="size-4" aria-hidden="true" />{text.addDepartment}</Button>}</div></td></tr>
        {isExpanded && (children.length ? children.map(child) : <tr><td colSpan={4} className="py-4 pl-16 text-text-gray">{text.emptyDepartments}</td></tr>)}
        </Fragment>
      })}
      {unassigned.length > 0 && <tr><th colSpan={4} className="bg-beige/20 p-4 text-maroon">{text.unassigned}</th></tr>}
      {unassigned.map(child)}
      {!rows.length && !unassigned.length && <tr><td colSpan={4} className="p-10 text-center text-text-gray">{text.empty}</td></tr>}
    </tbody></table>
  </div>
}
