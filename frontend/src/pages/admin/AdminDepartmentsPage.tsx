import { Fragment, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ChevronDown, ChevronRight, Eye, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'
import { SelectField } from '../../components/ui/SelectField'
import { FilterPopover } from '../../components/ui/FilterPopover'
import { LIST_TOOLBAR } from '../../components/ui/toolbar'
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
import { filtersEn } from '../../content/filters.en'
import { organizationAdminEn as text } from '../../content/organizationAdmin.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useOrganizationManagement } from '../../hooks/useOrganizationManagement'
import { departmentsKept, filterSelection } from '../../lib/organization'
import { formatCount } from '../../lib/count'
import { departmentDeleteBlocker, DIVISION_SORTS, hierarchyRows, managementFilterData, sortGroup, unassignedRows, type DivisionSort } from '../../lib/organizationAdmin'
import { deleteDivision, type DivisionRecord, type ManagedDepartment, type ManagementSnapshot } from '../../services/organizationAdmin'

export interface AdminDepartmentsLocationState { removed?: string }

export function AdminDepartmentsPage() {
  useDocumentTitle(text.title)
  const { data, error, refresh } = useOrganizationManagement()
  const [query, setQuery] = useState('')
  const [divisionFilter, setDivisionFilter] = useState<string[]>([])
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([])
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
  // Chips come from the loaded divisions and departments, with the linked rule of every list page: the Department
  // chips follow the selected divisions, and choices no longer offered (removed, or outside them) are dropped.
  const filterData = useMemo(() => managementFilterData(data ?? { divisions: [], departments: [] }), [data])
  const { divisionChoices, divisions: selectedDivisions, groups: departmentGroups, departments: selectedDepartments } = useMemo(
    () => filterSelection(filterData, divisionFilter, departmentFilter), [filterData, divisionFilter, departmentFilter])
  // Deselecting a division also deselects its departments.
  const setDivisions = (ids: string[]) => { setDivisionFilter(ids); setDepartmentFilter(departmentsKept(filterData, ids, selectedDepartments)) }
  const clearFilter = () => { setDivisionFilter([]); setDepartmentFilter([]) }
  const departmentLabel = (id: string) => data?.departments.find((row) => row.id === id)?.name ?? id
  // How many divisions the table shows (search and filters applied), above it as on Staff and Admins.
  const shownDivisions = useMemo(
    () => (data ? hierarchyRows(data, query, { divisions: selectedDivisions, departments: selectedDepartments }).length : 0),
    [data, query, selectedDivisions, selectedDepartments])
  const close = () => { setEditing(undefined); setPreview(undefined); setDeleting(undefined); setDepartment(undefined); setViewing(undefined); setDepartmentForm(undefined); trigger.current?.focus() }
  return <>
    {/* The title and its description, with Add Division on the right, as on the Admins page. */}
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl tracking-tight sm:text-3xl">{text.title}</h1>
      <p className="mt-2 max-w-2xl text-text-gray">{text.subtitle}</p></div>
      <Button className="shrink-0 self-start sm:self-auto" onClick={() => open(() => setEditing(null))}><Plus className="size-4" aria-hidden="true" />{text.addDivision}</Button></div>
    {/* Search | Filter | Sort, the same row as on every list page; from lg the Filter panel lines up with its right edge. */}
    <div className={`mt-6 ${LIST_TOOLBAR}`}>
      <TextField className="min-w-0" name="organizationSearch" type="search" label={text.search} placeholder={text.searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} />
      {/* The Filter field of every list page: Division, then Department grouped by division (the linked rule). */}
      <FilterPopover className="relative min-w-0 lg:static" label={filtersEn.label} allLabel={filtersEn.all} title={filtersEn.title} clearLabel={filtersEn.clearAll}
        onClear={clearFilter}
        sections={[
          { id: 'division', legend: filtersEn.division.legend, options: divisionChoices, value: selectedDivisions, onChange: setDivisions,
            emptyText: filtersEn.division.empty, summary: filtersEn.division.count, scrollable: true },
          { id: 'department', legend: filtersEn.department.legend, value: selectedDepartments, onChange: setDepartmentFilter,
            emptyText: filtersEn.department.empty, summary: filtersEn.department.count, scrollable: true,
            groups: departmentGroups.map((group) => ({ id: group.id, label: group.unassigned ? filtersEn.department.unassigned : group.label, options: group.options })) },
        ]} />
      <SelectField className="min-w-0" name="divisionSort" label={text.sort} value={sort}
        options={DIVISION_SORTS.map((value) => {
          const group = sortGroup(value)
          return { value, label: text.sortOptions[value], ...(group ? { group: text.sortGroups[group] } : {}) }
        })}
        onChange={(event) => setSort(event.target.value as DivisionSort)} />
    </div>
    {(selectedDivisions.length > 0 || selectedDepartments.length > 0) && <ActiveFilters onClear={clearFilter} items={[
      ...divisionChoices.filter((option) => selectedDivisions.includes(option.value))
        .map((option) => ({ id: `division-${option.value}`, label: option.label, onRemove: () => setDivisions(selectedDivisions.filter((id) => id !== option.value)) })),
      ...selectedDepartments.map((id) => ({ id: `department-${id}`, label: departmentLabel(id), onRemove: () => setDepartmentFilter(selectedDepartments.filter((other) => other !== id)) })),
    ]} />}
    {/* The number of divisions, announced as it changes (as on Staff and Admins). */}
    {data && !error && <p role="status" className="mt-6 text-sm font-medium text-text-gray">{formatCount(shownDivisions, text.divisionCount)}</p>}
    <p role="status" className="mt-4 text-sm text-status-approved-fg">{feedback}</p>
    {error ? <div role="alert"><p>{text.loadFailed}</p><Button variant="secondary" onClick={() => void refresh()}>{text.retry}</Button></div>
      : !data ? <PageLoading /> : <HierarchyTable snapshot={data} query={query} divisions={selectedDivisions} departments={selectedDepartments} sort={sort}
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

/** The selected divisions, then departments, each removable, and Clear Filters (both). */
export function ActiveFilters({ items, onClear }: { items: { id: string; label: string; onRemove: () => void }[]; onClear: () => void }) {
  return <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
    <span className="text-text-gray">{text.filteredBy}</span>
    <ul aria-label={text.filterDivisions} className="flex min-w-0 flex-wrap items-center gap-2">
      {items.map((item) => <li key={item.id}>
        <button type="button" aria-label={text.removeFilter.replace('{name}', item.label)} onClick={item.onRemove}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-maroon/40 bg-white py-1 pr-2 pl-3 text-maroon transition-colors hover:bg-maroon/5">
          <span className="min-w-0 break-words">{item.label}</span><X aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
        </button></li>)}
    </ul>
    <button type="button" onClick={onClear} className="rounded-sm px-1 font-medium text-maroon underline underline-offset-2 hover:text-maroon-secondary">{text.clearFilters}</button>
  </div>
}

/** The disabled Delete icon's reason (tooltip and description), or none when the department can be deleted. */
function deleteBlockedReason(department: ManagedDepartment): string | undefined {
  const blocker = departmentDeleteBlocker(department)
  return blocker && { employees: text.departmentBlocked, sops: text.departmentHasSopsBlocked }[blocker]
}

/** Number columns: centred under their headings, the same in division and department rows. */
const numberCell = 'px-3 py-4 text-center tabular-nums'

/** An action column: its heading and its cells, centred so each button sits under its heading. */
const actionHead = 'px-2 py-4 text-center'
const actionCell = 'px-2 py-3 text-center [&>*]:mx-auto'

export function HierarchyTable({ snapshot, query = '', divisions = [], departments = [], sort = 'default', onPreview, onViewDepartment, onEdit, onDeleteDivision, onAddDepartment, onEditDepartment, onDeleteDepartment }: {
  snapshot: ManagementSnapshot; query?: string; divisions?: string[]; departments?: string[]; sort?: DivisionSort; onPreview: (division: DivisionRecord) => void;
  onViewDepartment: (department: ManagedDepartment) => void;
  onEdit: (division: DivisionRecord) => void; onDeleteDivision: (division: DivisionRecord) => void;
  onAddDepartment: (divisionId: string) => void; onEditDepartment: (department: ManagedDepartment) => void
  onDeleteDepartment: (department: ManagedDepartment) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // While searching, matching divisions open automatically, and so do divisions with departments chosen in the
  // filter; either can still be collapsed.
  const [collapsedInSearch, setCollapsedInSearch] = useState<Set<string>>(new Set())
  const searching = !!query.trim()
  const rows = hierarchyRows(snapshot, query, { divisions, departments, sort })
  const opensItself = (id: string) => searching || rows.some((row) => row.division.id === id && row.picked)
  const isOpen = (id: string) => opensItself(id) ? !collapsedInSearch.has(id) : expanded.has(id)
  const toggle = (id: string) => {
    const update = (previous: Set<string>) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next }
    if (opensItself(id)) setCollapsedInSearch(update); else setExpanded(update)
  }
  // Departments without a division: none with a division filter alone; only the chosen ones with a department filter.
  const unassigned = unassignedRows(snapshot, query, { divisions, departments })
  function child(row: ManagedDepartment) {
    return <tr key={row.id} className="border-t border-beige hover:bg-beige/20">
      <th scope="row" className="py-3 pr-4 pl-12 font-medium"><span className="flex items-center gap-3 border-l border-beige pl-5"><DepartmentBadge department={row} />
        <span className="min-w-0 break-words">{row.name}</span></span></th>
      <td className={numberCell}>{row.employees}</td><td className={numberCell}>{row.sops}</td><td />
      {/* Departments have no Add: that cell stays empty, so Preview, Edit and Delete sit under their headings. */}
      <td className={actionCell} />
      <td className={actionCell}><IconButton label={text.previewName.replace('{name}', row.name)} icon={Eye} onClick={() => onViewDepartment(row)} /></td>
      <td className={actionCell}><IconButton
        label={`${text.edit} ${row.name}`}
        icon={Pencil}
        disabledReason={row.deletion_job_id ? text.cleanupPending : undefined}
        onClick={() => onEditDepartment(row)}
      /></td>
      <td className={actionCell}><IconButton label={`${row.deletion_job_id ? text.retryCleanup : text.delete} ${row.name}`} icon={Trash2} danger disabledReason={deleteBlockedReason(row)} onClick={() => onDeleteDepartment(row)} /></td>
    </tr>
  }
  return <div className="mt-3 overflow-x-auto rounded-xl border border-beige bg-white">
    <table aria-label={text.title} className="w-full min-w-[600px] table-fixed text-left text-sm">
    {/* Fixed column widths, so expanding, searching, filtering or sorting never shifts the columns. Name, Staff
        and SOPs sit on the left; the empty column after them leaves room for more columns; the actions stay right. */}
    <colgroup><col className="w-[40%]" /><col className="w-28" /><col className="w-28" /><col /><col className="w-24" /><col className="w-24" /><col className="w-24" /><col className="w-24" /></colgroup><thead className={tableStyles.head}><tr>
      {/* "Name" lines up with the division names, after the expand arrow (1rem padding + 1.5rem arrow + 0.75rem gap). */}
      <th scope="col" className="py-4 pr-4 pl-[3.25rem]">{text.name}</th><th scope="col" className="px-3 py-4 text-center">{text.staff}</th><th scope="col" className="px-3 py-4 text-center">{text.sops}</th><th aria-hidden="true" />
      {/* One column per action, each heading centred above its button. */}
      <th scope="col" className={actionHead}>{text.actionColumns.add}</th><th scope="col" className={actionHead}>{text.actionColumns.preview}</th>
      <th scope="col" className={actionHead}>{text.actionColumns.edit}</th><th scope="col" className={actionHead}>{text.actionColumns.delete}</th>
    </tr></thead>
      {/* Each division is its own row group, with its departments in the next one (the toggle's aria-controls target), so they sit directly beneath it. */}
      {rows.map(({ division, children, departmentCount, employees, sops }) => {
        const isExpanded = isOpen(division.id)
        return <Fragment key={division.id}><tbody><tr className="border-t border-beige">
          <th scope="row" className="p-4">
            {/* The chevron and the division name are one toggle. */}
            <button type="button" aria-expanded={isExpanded} aria-controls={`children-${division.id}`}
              className="group flex items-start gap-3 rounded text-left" onClick={() => toggle(division.id)}>
              <span aria-hidden="true" className="mt-0.5 rounded p-1 text-maroon group-hover:bg-beige">{isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span>
              <span><span className="block font-semibold text-maroon">{division.name}</span>
                <span className="mt-1 block text-xs font-normal text-text-gray">{text.departments} ({departmentCount})</span></span>
            </button></th>
          <td className={numberCell}>{employees}</td><td className={numberCell}>{sops}</td><td />
          {/* Adds a department to this division, collapsed or expanded. */}
          <td className={actionCell}><IconButton label={text.addDepartment} icon={Plus} onClick={() => onAddDepartment(division.id)} /></td>
          <td className={actionCell}><IconButton label={text.previewName.replace('{name}', division.name)} icon={Eye} onClick={() => onPreview(division)} /></td>
          <td className={actionCell}><IconButton label={`${text.edit} ${division.name}`} icon={Pencil} onClick={() => onEdit(division)} /></td>
          <td className={actionCell}><IconButton label={`${text.delete} ${division.name}`} icon={Trash2} danger disabledReason={departmentCount ? text.divisionBlocked : undefined} onClick={() => onDeleteDivision(division)} /></td>
        </tr></tbody><tbody id={`children-${division.id}`} hidden={!isExpanded}>
        {isExpanded && (children.length ? children.map(child) : <tr className="border-t border-beige"><td colSpan={8} className="py-4 pl-16 text-text-gray">{text.emptyDepartments}</td></tr>)}
        </tbody></Fragment>
      })}
      <tbody>
      {unassigned.length > 0 && <tr><th colSpan={8} className="bg-beige/20 p-4 text-maroon">{text.unassigned}</th></tr>}
      {unassigned.map(child)}
      {!rows.length && !unassigned.length && <tr><td colSpan={8} className="p-10 text-center text-text-gray">{divisions.length || departments.length ? text.emptyFiltered : text.empty}</td></tr>}
    </tbody></table>
  </div>
}
