import { useEffect, useMemo, useState } from 'react'
import { Building2, FileText } from 'lucide-react'
import { SopGrid } from '../components/sops/SopGrid'
import { SopList } from '../components/sops/SopList'
import { Tabs, type TabItem } from '../components/ui/Tabs'
import { tabIds } from '../components/ui/tabIds'
import { ViewToggle, type ViewMode } from '../components/ui/ViewToggle'
import { sopsEn } from '../content/sops.en'
import type { SopTabKey } from '../content/types'
import { sops } from '../data/mock/sops'
import type { DepartmentId, Sop } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useActiveDepartment } from '../state/activeDepartmentContext'

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

/** The active department's SOPs, ordered for each tab. SOPs from other departments are never listed. */
function filterSops(tab: SopTabKey, all: Sop[], departmentId: DepartmentId): Sop[] {
  const inDepartment = all.filter((sop) => sop.departmentId === departmentId)
  switch (tab) {
    case 'recent':
      // ISO dates sort correctly as strings; newest first.
      return inDepartment.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated))
    case 'all':
    default:
      return inDepartment.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
  }
}

/** SOPs list ("/sops"): the active department's SOPs, with tabs, Grid/List views and an empty state. */
export function SopsPage() {
  const content = sopsEn
  useDocumentTitle(content.pageTitle)

  // TODO: Load the active department's SOPs from the backend API.
  const { activeDepartment } = useActiveDepartment()

  const [tab, setTab] = useState<SopTabKey>('all')
  const [view, setView] = useState<ViewMode>(readStoredView)

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view)
    } catch {
      // Remembering the view is optional; ignore storage errors.
    }
  }, [view])

  const tabItems: TabItem<SopTabKey>[] = (['all', 'recent'] as const).map((key) => ({
    key,
    label: content.tabs[key],
  }))
  const visibleSops = useMemo(() => filterSops(tab, sops, activeDepartment.id), [tab, activeDepartment.id])
  const ids = tabIds(TAB_ID_PREFIX, tab)

  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{content.subtitle}</p>
      <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-maroon">
        <Building2 aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
        <span className="sr-only">{content.departmentLabel}: </span>
        {activeDepartment.name}
      </p>

      {/* Tabs with the view toggle on the right (on its own line on narrow phones) */}
      <div className="mt-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-beige">
        <Tabs
          items={tabItems}
          selected={tab}
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
            <p className="mt-4 text-text-gray">{content.empty}</p>
          </div>
        ) : view === 'grid' ? (
          <SopGrid sops={visibleSops} content={content} />
        ) : (
          <SopList sops={visibleSops} content={content} />
        )}
      </div>
    </>
  )
}
