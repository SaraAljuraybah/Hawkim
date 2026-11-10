import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, FileText, Search } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Pagination } from '../components/ui/Pagination'
import { MultiSelectField } from '../components/ui/MultiSelectField'
import { TextField } from '../components/ui/TextField'
import { SelectField } from '../components/ui/SelectField'
import type { Department } from '../data/mock/types'
import type { MySopSort } from '../lib/mySops'
import { clampPage, listParam, pageCount, pageSlice, rememberedPagesFor, resultsParams, tabSwitch, updateParams, type RememberedPages } from '../lib/pagination'
import { ALL_DEPARTMENTS, DIRECTORY_URL_DEFAULTS, filterDirectorySops, OTHERS_SECTION, readDirectoryUrl, recentSince } from '../lib/sopDirectory'
import { departmentFilterOptions, divisionFilterOptions } from '../lib/userAdmin'
import { devSampleCount, devSampleSops } from '../lib/devSampleSops'
import { directorySopsFor } from '../lib/sopAccess'
import { adminSopPath, sopPath } from '../lib/routes'
import { useCurrentUser } from '../state/sessionContext'
import { useMyRequests } from '../state/requestsContext'
import { SopGrid } from '../components/sops/SopGrid'
import { SopList } from '../components/sops/SopList'
import { Tabs, type TabItem } from '../components/ui/Tabs'
import { tabIds } from '../components/ui/tabIds'
import { ViewToggle, type ViewMode } from '../components/ui/ViewToggle'
import { organizationAdminEn as filterText } from '../content/organizationAdmin.en'
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
  const requests = useMyRequests()
  const { departments, getDepartment } = useDepartments()

  // The tab, search, sort and page are kept in the URL, so a refresh or Back restores them.
  const [params, setParams] = useSearchParams()
  const { tab, query, sort, divisions: urlDivisions, departments: urlDepartments, page: urlPage } = useMemo(() => readDirectoryUrl(params), [params])
  // The admin's Filter by Division and Filter by Department, from the active departments; other roles see
  // one department. Choices that no longer exist (an old link) are dropped.
  const divisionChoices = useMemo(() => {
    const active = departments.filter((department) => !department.removedAt)
    return admin ? divisionFilterOptions(active, filterText.filterNoDivision) : []
  }, [admin, departments])
  const departmentChoices = useMemo(
    () => (admin ? departmentFilterOptions(departments.filter((department) => !department.removedAt)) : []),
    [admin, departments],
  )
  const filterDivisions = useMemo(() => urlDivisions.filter((id) => divisionChoices.some((option) => option.value === id)), [urlDivisions, divisionChoices])
  const filterDepartments = useMemo(() => urlDepartments.filter((id) => departmentChoices.some((option) => option.value === id)), [urlDepartments, departmentChoices])
  const searchRef = useRef<HTMLInputElement>(null)
  // The page each other tab was left on, for this department only: switching department starts every tab on page 1.
  const [memory, setMemory] = useState<RememberedPages<SopTabKey>>({ department: '', pages: {} })
  // The sort order isn't a filter: it doesn't show Clear Filters and isn't reset by it.
  const hasFilters = query.length > 0 || filterDivisions.length > 0 || filterDepartments.length > 0
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
  const authorized = useMemo(() => directorySopsFor(listSops, user, requests), [listSops, user, requests])
  // Others (SOPs of deleted departments) is a tab only for people who may open some of them.
  const hasOthers = useMemo(() => filterDirectorySops(authorized, OTHERS_SECTION).length > 0, [authorized])
  const tabKeys: SopTabKey[] = hasOthers ? ['all', 'recent', 'others'] : ['all', 'recent']
  const tabItems: TabItem<SopTabKey>[] = tabKeys.map((key) => ({
    key,
    label: content.tabs[key],
  }))
  const showingOthers = tab === 'others' && hasOthers
  // Recently Published: dated within the last RECENT_MONTHS months.
  const since = tab === 'recent' ? recentSince() : undefined
  const visibleSops = useMemo(
    () => filterDirectorySops(authorized, showingOthers ? OTHERS_SECTION : admin ? ALL_DEPARTMENTS : activeDepartment.id, query, sort, {
      since, divisions: filterDivisions, getDepartment, departments: filterDepartments,
    }),
    [authorized, showingOthers, admin, activeDepartment.id, query, sort, since, filterDivisions, getDepartment, filterDepartments],
  )
  // A remembered Others tab falls back to All once there is nothing in Others.
  const selectedTab: SopTabKey = showingOthers || tab !== 'others' ? tab : 'all'
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
  const setDivisions = (ids: string[]) => changeResults({ division: listParam(ids) })
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

  function clearFilters() {
    changeResults({ q: undefined, division: undefined, dept: undefined })
    searchRef.current?.focus()
  }

  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{content.subtitle}</p>
      {/* The department shown; the admin sees every department, so has none */}
      {!admin && (
        <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-maroon">
          <Building2 aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
          {showingOthers ? content.othersSection : <><span className="sr-only">{content.departmentLabel}: </span>{activeDepartment.name}</>}
        </p>
      )}

      <div role="search" aria-label={content.filters.label} className="mt-6 rounded-xl border border-beige bg-white p-4 sm:p-5">
        {/* Admin: Search, Filter by Division, Filter by Department and Sort By, stacked on phones, 2×2 from sm and one
            row from xl (narrower, they'd cut off their values). Others: Search and Sort By on one row from sm. */}
        <div className={`grid items-end gap-4 ${admin ? 'sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]' : 'sm:grid-cols-[minmax(0,1fr)_12rem]'}`}>
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
            <>
              {/* As on Divisions & Departments: a visible label; the control's accessible name is the same text. */}
              <div className="min-w-0">
                <span aria-hidden="true" className="mb-1.5 block text-sm font-medium text-maroon">{filterText.filterDivisions}</span>
                <MultiSelectField name="divisionFilter" label={filterText.filterDivisions} placeholder={filterText.filterPlaceholder} emptyText={filterText.filterEmpty}
                  options={divisionChoices} value={filterDivisions} onChange={setDivisions} />
              </div>
              <div className="min-w-0">
                <span aria-hidden="true" className="mb-1.5 block text-sm font-medium text-maroon">{filterText.filterDepartments}</span>
                <MultiSelectField name="departmentFilter" label={filterText.filterDepartments} placeholder={filterText.filterDepartmentsPlaceholder}
                  emptyText={filterText.filterDepartmentsEmpty} options={departmentChoices} value={filterDepartments} onChange={setDepartments} />
              </div>
            </>
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
          {hasFilters && <Button size="sm" variant="secondary" onClick={clearFilters}>{content.filters.clear}</Button>}
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
              {hasFilters ? content.filters.empty : showingOthers ? content.othersEmpty : selectedTab === 'recent' ? content.recentEmpty : admin ? content.adminEmpty : content.empty}
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
