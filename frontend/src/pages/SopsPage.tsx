import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText, Search } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Pagination } from '../components/ui/Pagination'
import { FilterPopover } from '../components/ui/FilterPopover'
import { TextField } from '../components/ui/TextField'
import { SelectField } from '../components/ui/SelectField'
import type { Department } from '../data/mock/types'
import type { MySopSort } from '../lib/mySops'
import { clampPage, listParam, pageCount, pageSlice, rememberedPagesFor, resultsParams, tabSwitch, updateParams, type RememberedPages } from '../lib/pagination'
import { ALL_DEPARTMENTS, DIRECTORY_URL_DEFAULTS, EVERY_SOP, filterDirectorySops, readDirectoryUrl, recentSince } from '../lib/sopDirectory'
import { departmentFilterGroups, type FilterDepartments } from '../lib/organization'
import { devSampleCount, devSampleSops } from '../lib/devSampleSops'
import { directorySopsFor } from '../lib/sopAccess'
import { adminSopPath, sopPath } from '../lib/routes'
import { useCurrentUser } from '../state/sessionContext'
import { SopGrid } from '../components/sops/SopGrid'
import { SopList } from '../components/sops/SopList'
import { Tabs, type TabItem } from '../components/ui/Tabs'
import { tabIds } from '../components/ui/tabIds'
import { ViewToggle, type ViewMode } from '../components/ui/ViewToggle'
import { paginationEn } from '../content/pagination.en'
import { sopsEn } from '../content/sops.en'
import type { SopTabKey } from '../content/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useActiveDepartment } from '../state/activeDepartmentContext'
import { useDepartments } from '../state/departmentsContext'
import { useSops } from '../state/sopsContext'

const TAB_ID_PREFIX = 'sops'
const VIEW_STORAGE_KEY = 'hawkim.sops.view'

/** Reads the remembered view; storage can be unavailable (private mode, blocked). */
function readStoredView(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY)
    return stored === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

/** SOPs list ("/sops"): the active department's SOPs (chosen with the top bar's switcher), with tabs, Grid/List views and an empty state. */
export function SopsPage() {
  const { activeDepartment } = useActiveDepartment()
  return <SopDirectory activeDepartment={activeDepartment} />
}

/**
 * The SOP Directory in the admin portal ("/admin/sops"), read-only: every department's published SOPs
 * (not Others), with Filter by Division and Filter by Department instead of a department switcher. The
 * database decides which SOPs an admin can read (admin_can_read_published_sop).
 */
export function AdminSopsPage() {
  const user = useCurrentUser()
  const department = useDepartments().getDepartment(user.departmentId)
  // The department list is loaded before the portal opens; this only covers a department that's gone.
  const home: Department = department ?? { id: user.departmentId, name: user.departmentId, initials: '', description: '' }
  return <SopDirectory activeDepartment={home} admin />
}

function SopDirectory({ activeDepartment, admin = false }: { activeDepartment: Department; admin?: boolean }) {
  const content = sopsEn
  useDocumentTitle(admin ? content.adminPageTitle : content.pageTitle)
  const sopHref = admin ? adminSopPath : sopPath

  const { sops } = useSops()
  const user = useCurrentUser()
  const { departments, getDepartment } = useDepartments()

  // The tab, search, sort and page are kept in the URL, so a refresh or Back restores them.
  const [params, setParams] = useSearchParams()
  const { tab, query, sort, divisions: urlDivisions, departments: urlDepartments, page: urlPage } = useMemo(() => readDirectoryUrl(params), [params])
  // The admin's Filter (Division and Department chips, as on Organizational Structure), from the active
  // departments; other roles have no filter. Choices that no longer exist (an old link) are dropped.
  const filterData = useMemo<FilterDepartments>(() => {
    const active = admin ? departments.filter((department) => !department.removedAt) : []
    const divisions = new Map<string, string>()
    for (const department of active) if (department.divisionId) divisions.set(department.divisionId, department.divisionName ?? department.divisionId)
    return {
      divisions: [...divisions].map(([id, name]) => ({ id, name })),
      departments: active.map((department) => ({ id: department.id, name: department.name, divisionId: department.divisionId })),
    }
  }, [admin, departments])
  const divisionChoices = useMemo(() => [...filterData.divisions]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
    .map((division) => ({ value: division.id, label: division.name })), [filterData])
  const filterDivisions = useMemo(() => urlDivisions.filter((id) => divisionChoices.some((option) => option.value === id)), [urlDivisions, divisionChoices])
  // The Department chips follow the selected divisions; a selected department no longer offered is dropped.
  const departmentGroups = useMemo(() => departmentFilterGroups(filterData, filterDivisions), [filterData, filterDivisions])
  const filterDepartments = useMemo(
    () => urlDepartments.filter((id) => departmentGroups.some((group) => group.options.some((option) => option.value === id))),
    [urlDepartments, departmentGroups],
  )
  const searchRef = useRef<HTMLInputElement>(null)
  // The page each other tab was left on, for this department only: switching department starts every tab on page 1.
  const [memory, setMemory] = useState<RememberedPages<SopTabKey>>({ department: '', pages: {} })
  // The sort order isn't a filter: it doesn't show Clear Filters and isn't reset by it.
  const hasFilters = query.length > 0 || filterDivisions.length > 0 || filterDepartments.length > 0
  // Clear Filters: everyone else's shows for the search; the admin's also for the filters and a sort other than the default.
  const showClear = hasFilters || (admin && sort !== DIRECTORY_URL_DEFAULTS.sort)
  const [view, setView] = useState<ViewMode>(readStoredView)

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view)
    } catch {
      // Remembering the view is optional; ignore storage errors.
    }
  }, [view])

  // DEVELOPMENT ONLY (?devSops=40): sample SOPs to try pagination; left out of the production build.
  const listSops = useMemo(() => {
    if (!import.meta.env.DEV) return sops
    const count = devSampleCount(params)
    return count ? [...sops, ...devSampleSops(count, user.id, activeDepartment.id, true)] : sops
  }, [sops, params, user.id, activeDepartment.id])
  // Only published SOPs: the System Admin's are every department's; everyone else's are those they
  // worked on, in any department (Others included). The active department doesn't narrow it.
  const authorized = useMemo(() => directorySopsFor(listSops, user), [listSops, user])
  const tabKeys: SopTabKey[] = ['all', 'recent']
  const tabItems: TabItem<SopTabKey>[] = tabKeys.map((key) => ({
    key,
    label: content.tabs[key],
  }))
  // Recently Published: dated within the last RECENT_MONTHS months.
  const since = tab === 'recent' ? recentSince() : undefined
  const visibleSops = useMemo(
    () => filterDirectorySops(authorized, admin ? ALL_DEPARTMENTS : EVERY_SOP, query, sort, {
      since, divisions: filterDivisions, getDepartment, departments: filterDepartments,
    }),
    [authorized, admin, query, sort, since, filterDivisions, getDepartment, filterDepartments],
  )
  const selectedTab: SopTabKey = tab
  const ids = tabIds(TAB_ID_PREFIX, selectedTab)
  // A page that's too high (an old link) shows the last page.
  const pages = pageCount(visibleSops.length)
  const page = clampPage(urlPage, pages)
  const pageSops = pageSlice(visibleSops, page)
  const tabPages = rememberedPagesFor(memory, activeDepartment.id)
  const rememberPages = (next: Partial<Record<SopTabKey, number>>) => setMemory({ department: activeDepartment.id, pages: next })

  // Replacing the URL: typing in search doesn't add a history entry per letter. Only a page change does.
  function change(changes: Record<string, string | number | undefined>, replace = true) {
    setParams((current) => updateParams(current, changes, DIRECTORY_URL_DEFAULTS), { replace })
  }
  // New results: every tab starts again on page 1.
  function changeResults(changes: Record<string, string | undefined>) {
    rememberPages({})
    setParams((current) => resultsParams(current, changes, DIRECTORY_URL_DEFAULTS), { replace: true })
  }
  const setQuery = (value: string) => changeResults({ q: value })
  const setSort = (value: MySopSort) => changeResults({ sort: value })
  // Independent: changing one never changes the other.
  // Deselecting a division also deselects its departments (one change of the URL).
  const setDivisions = (ids: string[]) => {
    const offered = departmentFilterGroups(filterData, ids).flatMap((group) => group.options.map((option) => option.value))
    changeResults({ division: listParam(ids), dept: listParam(filterDepartments.filter((id) => offered.includes(id))) })
  }
  const setDepartments = (ids: string[]) => changeResults({ dept: listParam(ids) })

  // Each tab opens on the page it was left on.
  function setTab(next: SopTabKey) {
    if (next === selectedTab) return
    const switched = tabSwitch(params, tabPages, selectedTab, page, next, DIRECTORY_URL_DEFAULTS)
    rememberPages(switched.pages)
    setParams(switched.params, { replace: true })
  }

  // A new page: back to the top of the list, with focus on it, so keyboard and screen-reader users land on the new results.
  function goToPage(next: number) {
    change({ page: next }, false)
    requestAnimationFrame(() => {
      const panel = document.getElementById(ids.panel)
      panel?.scrollIntoView({ block: 'start' })
      panel?.focus({ preventScroll: true })
    })
  }

  // Clear Filters: the search and filters (and, for the admin, the sort) at once, in one URL update. The tab and view stay.
  function clearFilters() {
    changeResults({ q: undefined, division: undefined, dept: undefined, ...(admin ? { sort: undefined } : {}) })
    searchRef.current?.focus()
  }
  // The panel's Clear all: divisions and departments only (not the search or sort), in one URL update.
  const clearDivisionsAndDepartments = () => changeResults({ division: undefined, dept: undefined })

  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{admin ? content.adminSubtitle : content.subtitle}</p>

      <div role="search" aria-label={content.filters.label} className="mt-6 rounded-xl border border-beige bg-white p-4 sm:p-5">
        {/* Admin: Search, Filter by Division, Filter by Department and Sort By, stacked on phones, 2×2 from sm and one
            row from xl (narrower, they'd cut off their values). Others: Search and Sort By on one row from sm. */}
        <div className={`grid items-end gap-4 ${admin ? 'relative lg:grid-cols-[minmax(0,4fr)_auto_minmax(0,1fr)]' : 'sm:grid-cols-[minmax(0,1fr)_12rem]'}`}>
          <TextField
            ref={searchRef}
            name="sopSearch"
            type="search"
            label={content.filters.searchLabel}
            placeholder={content.filters.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            endAdornment={<Search aria-hidden="true" className="mr-2 size-4 text-text-gray" />}
          />
          {admin && (
            // As on Organizational Structure: a labelled icon button whose panel lines up with this row's right edge (from lg).
            <FilterPopover className="relative min-w-0 lg:static" label={content.filters.panel.filter} activeLabel={content.filters.panel.filterActive}
              title={content.filters.panel.title} clearLabel={content.filters.panel.clearAll} onClear={clearDivisionsAndDepartments}
              sections={[
                { id: 'division', legend: content.filters.panel.division, options: divisionChoices, value: filterDivisions, onChange: setDivisions,
                  emptyText: content.filters.panel.divisionEmpty, scrollable: true },
                { id: 'department', legend: content.filters.panel.department, value: filterDepartments, onChange: setDepartments,
                  emptyText: content.filters.panel.departmentEmpty, scrollable: true,
                  groups: departmentGroups.map((group) => ({ id: group.id, label: group.unassigned ? content.filters.panel.unassigned : group.label, options: group.options })) },
              ]} />
          )}
          <SelectField
            name="sopSort"
            label={content.filters.sortLabel}
            value={sort}
            onChange={(event) => setSort(event.target.value as MySopSort)}
            options={[{ value: 'newest', label: content.filters.sortNewest }, { value: 'oldest', label: content.filters.sortOldest }]}
          />
        </div>
        <div className="mt-3 flex min-h-8 flex-wrap items-center justify-between gap-2">
          <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-text-gray">
            {visibleSops.length === 1 ? content.filters.oneResult : content.filters.results.replace('{count}', String(visibleSops.length))}
          </p>
          {showClear && <Button size="sm" variant="secondary" onClick={clearFilters}>{content.filters.clear}</Button>}
        </div>
      </div>

      {/* Tabs with the view toggle on the right (on its own line on narrow phones) */}
      <div className="mt-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-beige">
        <Tabs
          items={tabItems}
          selected={selectedTab}
          onSelect={setTab}
          label={content.tabsLabel}
          idPrefix={TAB_ID_PREFIX}
        />
        <div className="order-first flex w-full justify-end pb-2 sm:order-none sm:w-auto">
          <ViewToggle value={view} onChange={setView} labels={content.viewToggle} />
        </div>
      </div>

      <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} tabIndex={0} className="mt-6 rounded-xl">
        {visibleSops.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-beige bg-white px-6 py-14 text-center">
            <span
              aria-hidden="true"
              className="inline-flex size-12 items-center justify-center rounded-lg bg-beige text-maroon"
            >
              <FileText className="size-6" strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-text-gray">
              {hasFilters ? content.filters.empty : selectedTab === 'recent' ? content.recentEmpty : admin ? content.adminEmpty : content.empty}
            </p>
          </div>
        ) : view === 'grid' ? (
          <SopGrid sops={pageSops} content={content} sopHref={sopHref} />
        ) : (
          <SopList sops={pageSops} content={content} sopHref={sopHref} />
        )}
      </div>

      <Pagination page={page} count={pages} total={visibleSops.length} onChange={goToPage} content={paginationEn} className="mt-8" />
    </>
  )
}
