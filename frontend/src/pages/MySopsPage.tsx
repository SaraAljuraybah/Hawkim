import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CircleCheck, FileText, Search, Upload } from 'lucide-react'
import { AuthoredSopGrid } from '../components/mySops/AuthoredSopGrid'
import { AuthoredSopList } from '../components/mySops/AuthoredSopList'
import { Button } from '../components/ui/Button'
import { SelectField } from '../components/ui/SelectField'
import { Tabs } from '../components/ui/Tabs'
import { tabIds } from '../components/ui/tabIds'
import { TextField } from '../components/ui/TextField'
import { ViewToggle, type ViewMode } from '../components/ui/ViewToggle'
import { mySopsEn } from '../content/mySops.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { hasPermission } from '../lib/permissions'
import { authoredSopsFor, filterMySops, type MySopCategory, type MySopRole } from '../lib/mySops'
import { useActiveDepartment } from '../state/activeDepartmentContext'
import { useCurrentUser } from '../state/sessionContext'
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

  const { sops } = useSops()
  const { homeDepartment } = useActiveDepartment()
  const [statusMessage, setStatusMessage] = useState('')
  const [category, setCategory] = useState<MySopCategory>('new')
  const [query, setQuery] = useState('')
  const [sopId, setSopId] = useState('')
  const [updatedDate, setUpdatedDate] = useState('')
  const [role, setRole] = useState<MySopRole>('all')
  const [view, setView] = useState<ViewMode>(readStoredView)
  const searchRef = useRef<HTMLInputElement>(null)
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

  const authoredSops = useMemo(
    () => authoredSopsFor(sops, user.id, homeDepartment.id),
    [sops, user.id, homeDepartment.id],
  )
  const visibleSops = useMemo(
    () => filterMySops(authoredSops, user.id, { category, query, sopId, updatedDate, role }),
    [authoredSops, user.id, category, query, sopId, updatedDate, role],
  )
  const nameOptions = useMemo(
    () => [...authoredSops].sort((a, b) => a.title.localeCompare(b.title)).map((sop) => ({ value: sop.id, label: sop.title })),
    [authoredSops],
  )
  const hasFilters = query.length > 0 || sopId !== '' || updatedDate !== '' || role !== 'all'
  const ids = tabIds(TAB_ID_PREFIX, category)

  function clearFilters() {
    setQuery('')
    setSopId('')
    setUpdatedDate('')
    setRole('all')
    searchRef.current?.focus()
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

      {/* Success message after an upload (live region stays mounted) */}
      <div role="status">
        {statusMessage && (
          <p className="mt-6 flex items-center gap-2.5 rounded-lg border border-status-approved-fg/20 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {statusMessage}
          </p>
        )}
      </div>

      <div role="search" aria-label={content.filters.label} className="mt-6 rounded-xl border border-beige bg-white p-4 sm:p-5">
        <div className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_11rem_11rem]">
          <TextField
            ref={searchRef}
            name="mySopSearch"
            type="search"
            label={content.filters.searchLabel}
            placeholder={content.filters.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            endAdornment={<Search aria-hidden="true" className="mr-2 size-4 text-text-gray" />}
          />
          <SelectField name="mySopName" label={content.filters.nameLabel} value={sopId} onChange={(event) => setSopId(event.target.value)} options={[{ value: '', label: content.filters.allNames }, ...nameOptions]} />
          <TextField name="mySopUpdatedDate" type="date" label={content.filters.dateLabel} value={updatedDate} onChange={(event) => setUpdatedDate(event.target.value)} />
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
          <Tabs items={(['new', 'progress', 'completed'] as const).map((key) => ({ key, label: content.tabs[key] }))} selected={category} onSelect={setCategory} label={content.tabsLabel} idPrefix={TAB_ID_PREFIX} />
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
          <AuthoredSopGrid sops={visibleSops} content={content} userId={user.id} />
        ) : (
          <AuthoredSopList sops={visibleSops} content={content} userId={user.id} />
        )}
      </div>
    </>
  )
}
