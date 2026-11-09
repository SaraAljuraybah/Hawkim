import { Fragment, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ChevronDown, ChevronRight, Eye, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'
import { SelectField } from '../../components/ui/SelectField'
import { MultiSelectField } from '../../components/ui/MultiSelectField'
import { IconButton } from '../../components/ui/IconButton'
import { FormDialog } from '../../components/ui/FormDialog'
import { PageLoading } from '../../components/ui/PageLoading'
import { tableStyles } from '../../components/ui/tableStyles'
import { DepartmentBadge } from '../../components/admin/DepartmentBadge'
import { DivisionForm, DivisionPreview } from '../../components/admin/DivisionDialogs'
import { DeleteDepartmentDialog } from '../../components/admin/DeleteDepartmentDialog'
import { DepartmentPreview } from '../../components/admin/DepartmentPreview'
import { DepartmentForm } from '../../components/admin/DepartmentDialog'
import { adminEn } from '../../content/admin.en'
import { organizationAdminEn as text } from '../../content/organizationAdmin.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useOrganizationManagement } from '../../hooks/useOrganizationManagement'
import { departmentDeleteBlocker, DIVISION_SORTS, hierarchyRows, type DivisionSort } from '../../lib/organizationAdmin'
import { deleteDivision, type DivisionRecord, type ManagedDepartment, type ManagementSnapshot } from '../../services/organizationAdmin'

export interface AdminDepartmentsLocationState { removed?: string }

export function AdminDepartmentsPage() {
  useDocumentTitle(text.title)
  const { data, error, refresh } = useOrganizationManagement()
  const [query, setQuery] = useState('')
  const [divisionFilter, setDivisionFilter] = useState<string[]>([])
  const [sort, setSort] = useState<DivisionSort>('default')
  const [editing, setEditing] = useState<DivisionRecord | null | undefined>()
  const [preview, setPreview] = useState<DivisionRecord>()
  const [deleting, setDeleting] = useState<DivisionRecord>()
  const [department, setDepartment] = useState<ManagedDepartment>()
  const [viewing, setViewing] = useState<ManagedDepartment>()
  // Add Department (in a division) or Edit Department, in a dialog.
  const [departmentForm, setDepartmentForm] = useState<{ department?: ManagedDepartment; divisionId?: string }>()
  const notice = (useLocation().state as AdminDepartmentsLocationState | null)?.removed
  const [feedback, setFeedback] = useState(notice ?? '')
  const [actionError, setActionError] = useState('')
  const trigger = useRef<HTMLElement | null>(null)
  const open = (action: () => void) => { trigger.current = document.activeElement as HTMLElement; setFeedback(''); setActionError(''); action() }
  // Options come from the loaded divisions. A selected division that no longer exists is dropped.
  const divisionOptions = useMemo(() => [...(data?.divisions ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
    .map((division) => ({ value: division.id, label: division.name })), [data])
  const selectedDivisions = divisionFilter.filter((id) => divisionOptions.some((option) => option.value === id))
  const close = () => { setEditing(undefined); setPreview(undefined); setDeleting(undefined); setDepartment(undefined); setViewing(undefined); setDepartmentForm(undefined); trigger.current?.focus() }
  return <>
    <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl tracking-tight sm:text-3xl">{text.title}</h1>
      <Button onClick={() => open(() => setEditing(null))}><Plus className="size-4" aria-hidden="true" />{text.addDivision}</Button></div>
    {/* Search, filter and sort span the table's width (about 60/20/20 on large screens); they stack on small screens. */}
    <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
      <TextField className="min-w-0" name="organizationSearch" type="search" label={text.search} placeholder={text.searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="min-w-0">
        {/* Visible label; the control's accessible name is the same text. */}
        <span aria-hidden="true" className="mb-1.5 block text-sm font-medium text-maroon">{text.filterDivisions}</span>
        <MultiSelectField name="divisionFilter" label={text.filterDivisions} placeholder={text.filterPlaceholder} emptyText={text.filterEmpty}
          options={divisionOptions} value={selectedDivisions} onChange={setDivisionFilter} />
      </div>
      <SelectField className="min-w-0" name="divisionSort" label={text.sort} value={sort}
        options={DIVISION_SORTS.map((value) => ({ value, label: text.sortOptions[value] }))}
        onChange={(event) => setSort(event.target.value as DivisionSort)} />
    </div>
    {selectedDivisions.length > 0 && <ActiveFilters options={divisionOptions} selected={selectedDivisions} onChange={setDivisionFilter} />}
    <p role="status" className="mt-4 text-sm text-status-approved-fg">{feedback}</p>
    {error ? <div role="alert"><p>{text.loadFailed}</p><Button variant="secondary" onClick={() => void refresh()}>{text.retry}</Button></div>
      : !data ? <PageLoading /> : <HierarchyTable snapshot={data} query={query} divisions={selectedDivisions} sort={sort}
        onPreview={(row) => open(() => setPreview(row))} onViewDepartment={(row) => open(() => setViewing(row))} onEdit={(row) => open(() => setEditing(row))}
        onAddDepartment={(divisionId) => open(() => setDepartmentForm({ divisionId }))} onEditDepartment={(row) => open(() => setDepartmentForm({ department: row }))}
        onDeleteDivision={(row) => open(() => setDeleting(row))} onDeleteDepartment={(row) => open(() => setDepartment(row))} />}
    {editing !== undefined && <DivisionForm onSaved={() => setFeedback(text.saved)} division={editing ?? undefined} onClose={() => { close(); void refresh() }} />}
    {preview && <DivisionPreview division={preview} onClose={close} />}
    {deleting && <FormDialog open title={text.deleteTitle.replace('{name}', deleting.name)} description={text.deleteDivisionText}
      confirmLabel={text.delete} cancelLabel={text.cancel} onClose={close} onConfirm={async () => {
        try { await deleteDivision(deleting); setFeedback(text.removed); void refresh() }
        catch (reason) { setActionError((reason as Error).message); void refresh(); return false }
      }}>{actionError && <p role="alert" className="text-sm text-status-rejected-fg">{actionError}</p>}</FormDialog>}
    {departmentForm && data && <DepartmentForm snapshot={data} {...departmentForm} onClose={() => { close(); void refresh() }}
      onSaved={(notice) => setFeedback(adminEn.departmentDetails[notice])} />}
    {viewing && <DepartmentPreview department={viewing} divisionName={data?.divisions.find((item) => item.id === viewing.division_id)?.name} onClose={close} />}
    {department && <DeleteDepartmentDialog department={department} onClose={close} onDeleted={() => { setFeedback(text.removed); void refresh() }} />}
  </>
}

/** The selected divisions, each removable, and Clear Filters. */
export function ActiveFilters({ options, selected, onChange }: { options: { value: string; label: string }[]; selected: string[]; onChange: (next: string[]) => void }) {
  return <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
    <span className="text-text-gray">{text.filteredBy}</span>
    <ul aria-label={text.filterDivisions} className="flex min-w-0 flex-wrap items-center gap-2">
      {options.filter((option) => selected.includes(option.value)).map((option) => <li key={option.value}>
        <button type="button" aria-label={text.removeFilter.replace('{name}', option.label)} onClick={() => onChange(selected.filter((id) => id !== option.value))}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-maroon/40 bg-white py-1 pr-2 pl-3 text-maroon transition-colors hover:bg-maroon/5">
          <span className="min-w-0 break-words">{option.label}</span><X aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
        </button></li>)}
    </ul>
    <button type="button" onClick={() => onChange([])} className="rounded-sm px-1 font-medium text-maroon underline underline-offset-2 hover:text-maroon-secondary">{text.clearFilters}</button>
  </div>
}

/** The disabled Delete icon's reason (tooltip and description), or none when the department can be deleted. */
function deleteBlockedReason(department: ManagedDepartment): string | undefined {
  const blocker = departmentDeleteBlocker(department)
  return blocker && { employees: text.departmentBlocked, sops: text.departmentHasSopsBlocked, both: text.departmentBlockedBoth }[blocker]
}

/** Number columns: centred under their headings, the same in division and department rows. */
const numberCell = 'px-3 py-4 text-center tabular-nums'

export function HierarchyTable({ snapshot, query = '', divisions = [], sort = 'default', onPreview, onViewDepartment, onEdit, onDeleteDivision, onAddDepartment, onEditDepartment, onDeleteDepartment }: {
  snapshot: ManagementSnapshot; query?: string; divisions?: string[]; sort?: DivisionSort; onPreview: (division: DivisionRecord) => void;
  onViewDepartment: (department: ManagedDepartment) => void;
  onEdit: (division: DivisionRecord) => void; onDeleteDivision: (division: DivisionRecord) => void;
  onAddDepartment: (divisionId: string) => void; onEditDepartment: (department: ManagedDepartment) => void
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
  const rows = hierarchyRows(snapshot, query, { divisions, sort })
  const divisionIds = new Set(snapshot.divisions.map((division) => division.id))
  // Departments without a division belong to none of the filtered divisions.
  const unassigned = divisions.length ? [] : snapshot.departments.filter((row) => (!row.division_id || !divisionIds.has(row.division_id)) && row.name.toLowerCase().includes(query.trim().toLowerCase()))
  function child(row: ManagedDepartment) {
    return <tr key={row.id} className="border-t border-beige hover:bg-beige/20">
      <th scope="row" className="py-3 pr-4 pl-12 font-medium"><span className="flex items-center gap-3 border-l border-beige pl-5"><DepartmentBadge department={row} />
        <span className="min-w-0 break-words">{row.name}</span></span></th>
      <td className={numberCell}>{row.employees}</td><td className={numberCell}>{row.sops}</td>
      <td className="p-3"><div className="flex justify-end gap-2"><IconButton label={text.previewName.replace('{name}', row.name)} icon={Eye} onClick={() => onViewDepartment(row)} />
        <IconButton
  label={`${text.edit} ${row.name}`}
  icon={Pencil}
  disabledReason={row.deletion_job_id ? text.cleanupPending : undefined}
  onClick={() => onEditDepartment(row)}
/>
        <IconButton label={`${row.deletion_job_id ? text.retryCleanup : text.delete} ${row.name}`} icon={Trash2} danger disabledReason={deleteBlockedReason(row)} onClick={() => onDeleteDepartment(row)} /></div></td>
    </tr>
  }
  return <div className="mt-3 overflow-x-auto rounded-xl border border-beige bg-white">
    <table aria-label={text.title} className="w-full min-w-[600px] table-fixed text-left text-sm">
    {/* Fixed column widths, so expanding, searching, filtering or sorting never shifts the columns. */}
    <colgroup><col /><col className="w-28" /><col className="w-28" /><col className="w-44" /></colgroup><thead className={tableStyles.head}><tr>
      <th scope="col" className="p-4">{text.name}</th><th scope="col" className="px-3 py-4 text-center">{text.users}</th><th scope="col" className="px-3 py-4 text-center">{text.sops}</th><th scope="col"><span className="sr-only">{text.edit}</span></th>
    </tr></thead><tbody>
      {rows.map(({ division, children, departmentCount, employees, sops }) => {
        const isExpanded = isOpen(division.id)
        return <Fragment key={division.id}><tr className="border-t border-beige">
          <th scope="row" className="p-4">
            {/* The chevron and the division name are one toggle. */}
            <button type="button" aria-expanded={isExpanded} aria-controls={`children-${division.id}`}
              className="group flex items-start gap-3 rounded text-left" onClick={() => toggle(division.id)}>
              <span aria-hidden="true" className="mt-0.5 rounded p-1 text-maroon group-hover:bg-beige">{isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span>
              <span><span className="block font-semibold text-maroon">{division.name}</span>
                <span className="mt-1 block text-xs font-normal text-text-gray">{text.departments} ({departmentCount})</span></span>
            </button></th>
          <td className={numberCell}>{employees}</td><td className={numberCell}>{sops}</td>
          <td className="p-3"><div className="flex justify-end gap-2"><IconButton label={text.previewName.replace('{name}', division.name)} icon={Eye} onClick={() => onPreview(division)} />
            <IconButton label={`${text.edit} ${division.name}`} icon={Pencil} onClick={() => onEdit(division)} />
            <IconButton label={`${text.delete} ${division.name}`} icon={Trash2} danger disabledReason={departmentCount ? text.divisionBlocked : undefined} onClick={() => onDeleteDivision(division)} /></div></td>
        </tr><tr id={`children-${division.id}`} hidden={!isExpanded}><td colSpan={4} className="border-t border-beige bg-beige/20 py-1.5 pr-3 pl-12"><div className="flex items-center justify-end">
          {isExpanded && <Button size="sm" onClick={() => onAddDepartment(division.id)}><Plus className="size-3.5" aria-hidden="true" />{text.addDepartment}</Button>}</div></td></tr>
        {isExpanded && (children.length ? children.map(child) : <tr><td colSpan={4} className="py-4 pl-16 text-text-gray">{text.emptyDepartments}</td></tr>)}
        </Fragment>
      })}
      {unassigned.length > 0 && <tr><th colSpan={4} className="bg-beige/20 p-4 text-maroon">{text.unassigned}</th></tr>}
      {unassigned.map(child)}
      {!rows.length && !unassigned.length && <tr><td colSpan={4} className="p-10 text-center text-text-gray">{divisions.length ? text.emptyFiltered : text.empty}</td></tr>}
    </tbody></table>
  </div>
}
