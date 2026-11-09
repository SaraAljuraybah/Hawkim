import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { CircleCheck, FileText, Upload } from 'lucide-react'
import { AuthoredSopGrid } from '../components/mySops/AuthoredSopGrid'
import { AuthoredSopList } from '../components/mySops/AuthoredSopList'
import { DeleteSopDialog } from '../components/mySops/DeleteSopDialog'
import { Button } from '../components/ui/Button'
import { Pagination } from '../components/ui/Pagination'
import { SearchCombobox } from '../components/ui/SearchCombobox'
import { SelectField } from '../components/ui/SelectField'
import { Tabs } from '../components/ui/Tabs'
import { tabIds } from '../components/ui/tabIds'
import { ViewToggle, type ViewMode } from '../components/ui/ViewToggle'
import { mySopsEn } from '../content/mySops.en'
import { paginationEn } from '../content/pagination.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { devSampleCount, devSampleSops } from '../lib/devSampleSops'
import { hasPermission } from '../lib/permissions'
import { authoredSopsFor, filterMySops, MY_SOPS_URL_DEFAULTS, mySopTitles, readMySopsUrl, sortMySops, type MySopCategory, type MySopRole, type MySopSort } from '../lib/mySops'
import { clampPage, pageAfterRemoval, pageCount, pageSlice, resultsParams, tabSwitch, updateParams } from '../lib/pagination'
import { useActiveDepartment } from '../state/activeDepartmentContext'
import { useCurrentUser } from '../state/sessionContext'
import type { Sop } from '../data/mock/types'
import { useSops } from '../state/sopsContext'
import { NotFoundPage } from './NotFoundPage'

const TAB_ID_PREFIX = 'my-sops'
const VIEW_STORAGE_KEY = 'hawkim.my-sops.view'

function readStoredView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

/** Navigation state set by Upload SOP after a successful upload. */
export interface MySopsLocationState {
  uploaded?: boolean
}

/** My SOPs ("/my-sops", Author permission): SOPs the user authored or co-authors in the home department. */
export function MySopsPage() {
  const content = mySopsEn
  const user = useCurrentUser()
  const isAuthor = hasPermission(user, 'author')
  // Non-authors get the Not Found page, which sets its own title.
  useDocumentTitle(isAuthor ? content.pageTitle : undefined)

  const { sops, deleteSop } = useSops()
  const { homeDepartment } = useActiveDepartment()
  const [statusMessage, setStatusMessage] = useState('')
  // The tab, search, sort, My Role and page are kept in the URL, so a refresh or Back restores them.
  const [params, setParams] = useSearchParams()
  const { category, query, sort, role, page: urlPage } = useMemo(() => readMySopsUrl(params), [params])
  // The page each other tab was left on, while the user stays on this page (the URL holds only the current tab's).
  const [tabPages, setTabPages] = useState<Partial<Record<MySopCategory, number>>>({})
  const [view, setView] = useState<ViewMode>(readStoredView)
  const searchRef = useRef<HTMLInputElement>(null)
  // The SOP being deleted, and the button that opened the dialog (focus goes back to it).
  const [deleting, setDeleting] = useState<Sop | null>(null)
  const deleteTriggerRef = useRef<HTMLElement | null>(null)
  const location = useLocation()
  const navigate = useNavigate()

  // After an upload: announce the success message, then clear it from history
  // so a reload doesn't show it again. The live region is already on the page,
  // and the text is set a moment later so screen readers reliably announce it.
  const uploaded = (location.state as MySopsLocationState | null)?.uploaded === true
  useEffect(() => {
    if (!uploaded) return
    // No cleanup: clearing the history state below re-runs this effect, which must not cancel the message.
    window.setTimeout(() => setStatusMessage(content.uploadedMessage), 100)
    navigate(location.pathname, { replace: true, state: null })
  }, [uploaded, content.uploadedMessage, location.pathname, navigate])

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view)
    } catch {
      // Remembering the presentation is optional when storage is unavailable.
    }
  }, [view])

  // DEVELOPMENT ONLY (?devSops=40): sample SOPs to try pagination; left out of the production build.
  const listSops = useMemo(() => {
    if (!import.meta.env.DEV) return sops
    const count = devSampleCount(params)
    return count ? [...sops, ...devSampleSops(count, user.id, homeDepartment.id)] : sops
  }, [sops, params, user.id, homeDepartment.id])
  const authoredSops = useMemo(
    () => authoredSopsFor(listSops, user.id, homeDepartment.id),
    [listSops, user.id, homeDepartment.id],
  )
  const visibleSops = useMemo(
    () => sortMySops(filterMySops(authoredSops, user.id, { category, query, role }), sort),
    [authoredSops, user.id, category, query, role, sort],
  )
  // Only titles in the current tab and role, so every suggestion gives a result.
  const titleOptions = useMemo(
    () => mySopTitles(filterMySops(authoredSops, user.id, { category, role })),
    [authoredSops, user.id, category, role],
  )
  // The sort order isn't a filter: it doesn't show Clear Filters and isn't reset by it.
  const hasFilters = query.length > 0 || role !== 'all'
  const ids = tabIds(TAB_ID_PREFIX, category)
  // A page that's too high (an old link, or after a delete) shows the last page.
  const pages = pageCount(visibleSops.length)
  const page = clampPage(urlPage, pages)
  const pageSops = pageSlice(visibleSops, page)

  // Replacing the URL: typing in search doesn't add a history entry per letter. Only a page change does.
  function change(changes: Record<string, string | number | undefined>, replace = true) {
    setParams((current) => updateParams(current, changes, MY_SOPS_URL_DEFAULTS), { replace })
  }
  // New results: every tab starts again on page 1.
  function changeResults(changes: Record<string, string | undefined>) {
    setTabPages({})
    setParams((current) => resultsParams(current, changes, MY_SOPS_URL_DEFAULTS), { replace: true })
  }
  const setQuery = (value: string) => changeResults({ q: value })
  const setSort = (value: MySopSort) => changeResults({ sort: value })
  const setRole = (value: MySopRole) => changeResults({ role: value })

  // Each tab opens on the page it was left on.
  function selectTab(next: MySopCategory) {
    if (next === category) return
    const switched = tabSwitch(params, tabPages, category, page, next, MY_SOPS_URL_DEFAULTS)
    setTabPages(switched.pages)
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
    changeResults({ q: undefined, role: undefined })
    searchRef.current?.focus()
  }

  function askToDelete(sop: Sop, trigger: HTMLElement) {
    deleteTriggerRef.current = trigger
    setDeleting(sop)
  }

  async function confirmDelete(reason: string) {
    if (!deleting) return
    await deleteSop(deleting.id, reason)
    setStatusMessage(content.deleteSop.deleted.replace('{title}', deleting.title))
    // The page's last SOP was deleted: show the previous page.
    const shownPage = pageAfterRemoval(page, visibleSops.length - 1)
    if (shownPage !== page) change({ page: shownPage })
  }

  function closeDelete() {
    setDeleting(null)
    // After a delete the button is gone: focus moves to the SOP list instead.
    requestAnimationFrame(() => {
      const trigger = deleteTriggerRef.current
      if (trigger?.isConnected) trigger.focus()
      else document.getElementById(ids.panel)?.focus()
    })
  }

  if (!isAuthor) return <NotFoundPage embedded />


  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
          <p className="mt-2 text-text-gray">{content.subtitle.replace('{department}', homeDepartment.name)}</p>
        </div>
        <Button to={content.upload.href} className="shrink-0 self-start">
          <Upload aria-hidden="true" className="size-4" strokeWidth={2} />
          {content.upload.label}
        </Button>
      </div>

      {/* Success message after an upload or a delete (live region stays mounted) */}
      <div role="status">
        {statusMessage && (
          <p className="mt-6 flex items-center gap-2.5 rounded-lg border border-status-approved-fg/20 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {statusMessage}
          </p>
        )}
      </div>

      <div role="search" aria-label={content.filters.label} className="mt-6 rounded-xl border border-beige bg-white p-4 sm:p-5">
        <div className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_13rem_11rem]">
          <SearchCombobox
            inputRef={searchRef}
            name="mySopSearch"
            label={content.filters.searchLabel}
            placeholder={content.filters.searchPlaceholder}
            value={query}
            onChange={setQuery}
            options={titleOptions}
            noMatchesText={content.filters.noTitles}
            toggleLabel={content.filters.showTitles}
            className="sm:col-span-2 xl:col-span-1"
          />
          <SelectField
            name="mySopSort"
            label={content.filters.sortLabel}
            value={sort}
            onChange={(event) => setSort(event.target.value as MySopSort)}
            options={[{ value: 'newest', label: content.filters.sortNewest }, { value: 'oldest', label: content.filters.sortOldest }]}
          />
          <SelectField
            name="mySopRole"
            label={content.filters.roleLabel}
            value={role}
            onChange={(event) => setRole(event.target.value as MySopRole)}
            options={[{ value: 'all', label: content.filters.allRoles }, { value: 'main', label: content.mainAuthorLabel }, { value: 'coauthor', label: content.coAuthorLabel }]}
          />
        </div>
        <div className="mt-3 flex min-h-8 flex-wrap items-center justify-between gap-2">
          <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-text-gray">
            {visibleSops.length === 1 ? content.filters.oneResult : content.filters.results.replace('{count}', String(visibleSops.length))}
          </p>
          {hasFilters && <Button size="sm" variant="secondary" onClick={clearFilters}>{content.filters.clear}</Button>}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-beige">
        <div className="max-w-full overflow-x-auto">
          <Tabs items={(['new', 'progress', 'completed'] as const).map((key) => ({ key, label: content.tabs[key] }))} selected={category} onSelect={selectTab} label={content.tabsLabel} idPrefix={TAB_ID_PREFIX} />
        </div>
        <div className="order-first flex w-full justify-end pb-2 sm:order-none sm:w-auto">
          <ViewToggle value={view} onChange={setView} labels={content.viewToggle} />
        </div>
      </div>

      <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} tabIndex={0} className="mt-6 rounded-xl">
        {visibleSops.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-beige bg-white px-6 py-14 text-center">
            <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-lg bg-beige text-maroon">
              <FileText className="size-6" strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-text-gray">{hasFilters ? content.filters.empty : content.empty}</p>
          </div>
        ) : view === 'grid' ? (
          <AuthoredSopGrid sops={pageSops} content={content} userId={user.id} onDelete={askToDelete} />
        ) : (
          <AuthoredSopList sops={pageSops} content={content} userId={user.id} onDelete={askToDelete} />
        )}
      </div>

      <Pagination page={page} count={pages} onChange={goToPage} content={paginationEn} className="mt-8" />

      {deleting && (
        <DeleteSopDialog title={deleting.title} content={content.deleteSop} onConfirm={confirmDelete} onClose={closeDelete} />
      )}
    </>
  )
}
