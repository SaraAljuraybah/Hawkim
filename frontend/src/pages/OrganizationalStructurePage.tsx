import { useEffect, useMemo, useState } from 'react'
import { OrganizationTable } from '../components/layout/OrganizationTable'
import { Button } from '../components/ui/Button'
import { FilterPopover } from '../components/ui/FilterPopover'
import { LIST_TOOLBAR } from '../components/ui/toolbar'
import { filtersEn } from '../content/filters.en'
import { SelectField } from '../components/ui/SelectField'
import { TextField } from '../components/ui/TextField'
import { adminEn } from '../content/admin.en'
import { organizationEn as content } from '../content/organization.en'
import { usersEn } from '../content/users.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { departmentFilterGroups, isFiltering, ORGANIZATION_SORTS, organizationRows, OTHERS_FILTER, ROLE_FILTERS, type OrganizationSort, type RoleFilter } from '../lib/organization'
import { fetchOrganization, type OrganizationHierarchy } from '../services/organization'
import { useCurrentUser } from '../state/sessionContext'

export type OrganizationLoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; hierarchy: OrganizationHierarchy }

const roleOptions = ROLE_FILTERS.map((role) => ({ value: role, label: role === OTHERS_FILTER ? content.others : usersEn.permissions[role] }))

/** The search, Filter and Sort toolbar and the table (view only). */
export function OrganizationStructure({ hierarchy }: { hierarchy: OrganizationHierarchy }) {
  const [query, setQuery] = useState('')
  const [divisionFilter, setDivisionFilter] = useState<string[]>([])
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([])
  const [roles, setRoles] = useState<RoleFilter[]>([])
  const [sort, setSort] = useState<OrganizationSort>('default')
  // Options come from the loaded divisions, A to Z. A selected division that no longer exists is dropped.
  const divisionOptions = useMemo(() => [...hierarchy.divisions]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
    .map((division) => ({ value: division.id, label: division.name })), [hierarchy])
  const divisions = divisionFilter.filter((id) => divisionOptions.some((option) => option.value === id))
  // Department chips follow the selected divisions; a selected department no longer offered is dropped.
  const departmentGroups = departmentFilterGroups(hierarchy, divisions)
  const departments = departmentFilter.filter((id) => departmentGroups.some((group) => group.options.some((option) => option.value === id)))
  // Deselecting a division also deselects its departments.
  const changeDivisions = (next: string[]) => {
    const offered = departmentFilterGroups(hierarchy, next).flatMap((group) => group.options.map((option) => option.value))
    setDivisionFilter(next)
    setDepartmentFilter(departments.filter((id) => offered.includes(id)))
  }
  const filters = { query, divisions, departments, roles }
  const filtering = isFiltering(filters)
  const rows = organizationRows(hierarchy, filters, sort)
  return (
    <>
      {/* Search | Filter | Sort, the same row as on every list page; from lg the Filter panel lines up with its right edge. */}
      <div className={`mt-6 ${LIST_TOOLBAR}`}>
        <TextField className="min-w-0" name="organizationSearch" type="search" label={content.search} placeholder={content.searchPlaceholder}
          autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
        <FilterPopover className="relative min-w-0 lg:static" label={filtersEn.label} allLabel={filtersEn.all} title={filtersEn.title} clearLabel={filtersEn.clearAll}
          sections={[
            { id: 'division', legend: filtersEn.division.legend, options: divisionOptions, value: divisions, onChange: changeDivisions,
              emptyText: filtersEn.division.empty, summary: filtersEn.division.count, scrollable: true },
            { id: 'department', legend: filtersEn.department.legend, value: departments, onChange: setDepartmentFilter,
              emptyText: filtersEn.department.empty, summary: filtersEn.department.count, scrollable: true,
              groups: departmentGroups.map((group) => ({ id: group.id, label: group.unassigned ? filtersEn.department.unassigned : group.label, options: group.options })) },
            { id: 'role', legend: content.roleFilter, options: roleOptions, value: roles, onChange: (next) => setRoles(next as RoleFilter[]), emptyText: '', summary: content.roleCount },
          ]} />
        <SelectField className="min-w-0" name="organizationSort" label={content.sort} value={sort}
          options={ORGANIZATION_SORTS.map((value) => ({ value, label: content.sortOptions[value] }))}
          onChange={(event) => setSort(event.target.value as OrganizationSort)} />
      </div>
      <OrganizationTable rows={rows} filtering={filtering} filterKey={JSON.stringify([query.trim().toLowerCase(), [...divisions].sort(), [...departments].sort(), [...roles].sort()])} />
    </>
  )
}

export function OrganizationContent({ state, reload }: { state: OrganizationLoadState; reload: () => void }) {
  if (state.status === 'loading') return (
    <div role="status" aria-label={content.loading} className="mt-6 space-y-4 motion-safe:animate-pulse">
      <span className="sr-only">{content.loading}</span>
      <div className="h-11 w-full rounded-lg bg-beige" />
      <div className="overflow-hidden rounded-xl border border-beige bg-white">
        <div className="h-12 bg-beige" />
        {[0, 1, 2, 3].map((key) => <div key={key} className="h-16 border-t border-beige" />)}
      </div>
    </div>
  )
  if (state.status === 'error') return (
    <div role="alert" className="mt-8 rounded-xl border border-beige bg-white p-6">
      <p className="mb-4 text-text-gray">{content.error}</p>
      <Button variant="secondary" onClick={reload}>{content.retry}</Button>
    </div>
  )
  return <OrganizationStructure hierarchy={state.hierarchy} />
}

/**
 * Organizational Structure, the same page for every signed-in user: in the employee app
 * ("/organizational-structure") and in the admin portal (`admin`, only the tab title differs).
 */
export function OrganizationalStructurePage({ admin = false }: { admin?: boolean }) {
  useDocumentTitle(admin ? adminEn.pageTitle.replace('{page}', content.title) : content.pageTitle)
  const user = useCurrentUser()
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ userId: string; attempt: number; state: OrganizationLoadState } | null>(null)
  const state: OrganizationLoadState = loaded?.userId === user.id && loaded.attempt === attempt ? loaded.state : { status: 'loading' }
  const reload = () => setAttempt((value) => value + 1)
  useEffect(() => {
    let active = true
    fetchOrganization().then(
      (hierarchy) => { if (active) setLoaded({ userId: user.id, attempt, state: { status: 'ready', hierarchy } }) },
      () => { if (active) setLoaded({ userId: user.id, attempt, state: { status: 'error' } }) },
    )
    return () => { active = false }
  }, [user.id, attempt])
  return (
    <div className="min-w-0">
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{content.subtitle}</p>
      <OrganizationContent state={state} reload={reload} />
    </div>
  )
}
