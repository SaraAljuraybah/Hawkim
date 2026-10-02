import { useEffect, useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { SopGrid } from '../components/sops/SopGrid'
import { SopList } from '../components/sops/SopList'
import { Tabs, type TabItem } from '../components/ui/Tabs'
import { tabIds } from '../components/ui/tabIds'
import { ViewToggle, type ViewMode } from '../components/ui/ViewToggle'
import { sopsEn } from '../content/sops.en'
import type { SopTabKey } from '../content/types'
import { currentUser } from '../data/mock/currentUser'
import { sops } from '../data/mock/sops'
import type { Sop } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

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

/** The SOPs shown in each tab. */
function filterSops(tab: SopTabKey, all: Sop[], departmentId: Sop['departmentId']): Sop[] {
  switch (tab) {
    case 'myDepartment':
      return all
        .filter((sop) => sop.departmentId === departmentId)
        .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
    case 'recent':
      // ISO dates sort correctly as strings; newest first.
      return [...all].sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated))
    case 'all':
    default:
      return [...all].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
  }
}

/** SOPs list ("/sops"): tabs, Grid/List views, empty state. */
export function SopsPage() {
  const content = sopsEn
  useDocumentTitle(content.pageTitle)

  // TODO: Use the authenticated user and API data once the backend exists.
  const user = currentUser

  const [tab, setTab] = useState<SopTabKey>('all')
  const [view, setView] = useState<ViewMode>(readStoredView)

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view)
    } catch {
      // Remembering the view is optional; ignore storage errors.
    }
  }, [view])

  const tabItems: TabItem<SopTabKey>[] = (['all', 'myDepartment', 'recent'] as const).map((key) => ({
    key,
    label: content.tabs[key],
  }))
  const visibleSops = useMemo(() => filterSops(tab, sops, user.departmentId), [tab, user.departmentId])
  const ids = tabIds(TAB_ID_PREFIX, tab)

  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{content.subtitle}</p>

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
