import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CircleCheck, FileText, Upload } from 'lucide-react'
import { AuthoredSopList } from '../components/mySops/AuthoredSopList'
import { Button } from '../components/ui/Button'
import { Tabs, type TabItem } from '../components/ui/Tabs'
import { tabIds } from '../components/ui/tabIds'
import { mySopsEn } from '../content/mySops.en'
import type { MySopsTabKey } from '../content/types'
import { currentUser } from '../data/mock/currentUser'
import type { Sop } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { hasPermission } from '../lib/permissions'
import { isAuthorOrCoAuthor } from '../lib/workflow'
import { useActiveDepartment } from '../state/activeDepartmentContext'
import { useSops } from '../state/sopsContext'
import type { SopStatus } from '../types/status'
import { NotFoundPage } from './NotFoundPage'

const TAB_ID_PREFIX = 'my-sops'

/** Statuses shown in each tab ("All" shows every status). */
const tabStatuses: Record<Exclude<MySopsTabKey, 'all'>, SopStatus[]> = {
  drafts: ['draft'],
  inProgress: ['in-review', 'in-approval', 'approved'],
  returned: ['returned'],
  published: ['published'],
}

/** Navigation state set by Upload SOP after a successful upload. */
export interface MySopsLocationState {
  uploaded?: boolean
}

/** My SOPs ("/my-sops", Author permission): SOPs the user authored or co-authors in the active department. */
export function MySopsPage() {
  const content = mySopsEn
  // TODO: Use the authenticated user once real authentication exists.
  const user = currentUser
  const isAuthor = hasPermission(user, 'author')
  // Non-authors get the Not Found page, which sets its own title.
  useDocumentTitle(isAuthor ? content.pageTitle : undefined)

  const { sops } = useSops()
  const { activeDepartment } = useActiveDepartment()
  const [tab, setTab] = useState<MySopsTabKey>('all')
  const [statusMessage, setStatusMessage] = useState('')
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

  const visibleSops = useMemo(() => {
    const inDepartment = sops.filter(
      (sop: Sop) => isAuthorOrCoAuthor(sop, user.id) && sop.departmentId === activeDepartment.id,
    )
    const inTab = tab === 'all' ? inDepartment : inDepartment.filter((sop) => tabStatuses[tab].includes(sop.status))
    // ISO dates sort correctly as strings; newest first (stable for the same day).
    return [...inTab].sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated))
  }, [sops, user.id, activeDepartment.id, tab])

  if (!isAuthor) return <NotFoundPage embedded />

  const tabItems: TabItem<MySopsTabKey>[] = (['all', 'drafts', 'inProgress', 'returned', 'published'] as const).map(
    (key) => ({ key, label: content.tabs[key] }),
  )
  const ids = tabIds(TAB_ID_PREFIX, tab)

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
          <p className="mt-2 text-text-gray">{content.subtitle.replace('{department}', activeDepartment.name)}</p>
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

      <div className="mt-8 border-b border-beige">
        <Tabs
          items={tabItems}
          selected={tab}
          onSelect={setTab}
          label={content.tabsLabel}
          idPrefix={TAB_ID_PREFIX}
          className="flex-wrap gap-y-1"
        />
      </div>

      <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} tabIndex={0} className="mt-6 rounded-xl">
        {visibleSops.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-beige bg-white px-6 py-14 text-center">
            <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-lg bg-beige text-maroon">
              <FileText className="size-6" strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-text-gray">{content.empty}</p>
          </div>
        ) : (
          <AuthoredSopList sops={visibleSops} content={content} userId={user.id} />
        )}
      </div>
    </>
  )
}
