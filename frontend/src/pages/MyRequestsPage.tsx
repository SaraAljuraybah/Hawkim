import { useMemo, useRef, useState } from 'react'
import { Building2, ClipboardList, Plus, ShieldCheck, UserCog, type LucideIcon } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { StatusBadge } from '../components/ui/StatusBadge'
import { Tabs, type TabItem } from '../components/ui/Tabs'
import { tabIds } from '../components/ui/tabIds'
import { requestsEn } from '../content/requests.en'
import type { RequestTabKey } from '../content/types'
import type { RequestType, UserRequest } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatDate } from '../lib/format'
import { useRequests } from '../state/requestsContext'

const TAB_ID_PREFIX = 'requests'

/** Icon for each request type. */
const typeIcons: Record<RequestType, LucideIcon> = {
  'department-access': Building2,
  'permission-change': ShieldCheck,
  'role-change': UserCog,
}

/** Requests shown in each tab, newest first. Cancelled requests appear under "All" only. */
function filterRequests(tab: RequestTabKey, requests: UserRequest[]): UserRequest[] {
  const visible = tab === 'all' ? requests : requests.filter((request) => request.status === tab)
  // ISO dates sort correctly as strings; the sort is stable, so same-day requests keep their order.
  return [...visible].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** My Requests ("/requests"): tabs, request list, cancel with confirmation. */
export function MyRequestsPage() {
  const content = requestsEn.myRequests
  const typeLabels = requestsEn.types
  useDocumentTitle(content.pageTitle)

  const { requests, cancelRequest } = useRequests()
  const [tab, setTab] = useState<RequestTabKey>('all')
  /** The request waiting for cancel confirmation (dialog open while set). */
  const [pendingCancel, setPendingCancel] = useState<UserRequest | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const cancelTriggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const tabItems: TabItem<RequestTabKey>[] = (['all', 'pending', 'approved', 'rejected'] as const).map((key) => ({
    key,
    label: content.tabs[key],
  }))
  const visibleRequests = useMemo(() => filterRequests(tab, requests), [tab, requests])
  const ids = tabIds(TAB_ID_PREFIX, tab)

  function confirmCancel() {
    if (!pendingCancel) return
    cancelRequest(pendingCancel.id)
    setPendingCancel(null)
    // The row's Cancel button is gone, so move focus to the list and announce the change.
    panelRef.current?.focus()
    setAnnouncement('')
    requestAnimationFrame(() => setAnnouncement(content.cancelledAnnouncement))
  }

  function keepRequest() {
    setPendingCancel(null)
    cancelTriggerRef.current?.focus()
  }

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
          <p className="mt-2 text-text-gray">{content.subtitle}</p>
        </div>
        <Button to={content.newRequest.href} className="shrink-0 self-start">
          <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
          {content.newRequest.label}
        </Button>
      </div>

      <div className="mt-8 border-b border-beige">
        <Tabs items={tabItems} selected={tab} onSelect={setTab} label={content.tabsLabel} idPrefix={TAB_ID_PREFIX} />
      </div>

      <div
        ref={panelRef}
        role="tabpanel"
        id={ids.panel}
        aria-labelledby={ids.tab}
        tabIndex={0}
        // Focus lands here after cancelling a request. Show the outline only for keyboard
        // users (:focus-visible), and keep it subtle: thin maroon line, small offset.
        className="mt-6 rounded-xl focus:outline-none focus-visible:outline-solid focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-maroon"
      >
        {visibleRequests.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-beige bg-white px-6 py-14 text-center">
            <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-lg bg-beige text-maroon">
              <ClipboardList className="size-6" strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-text-gray">{content.empty}</p>
          </div>
        ) : (
          <ul className="divide-y divide-beige rounded-xl border border-beige bg-white">
            {visibleRequests.map((request) => {
              const Icon = typeIcons[request.type]
              const titleId = `request-${request.id}-title`
              return (
                // TODO: Link each request to a request detail page once it exists.
                <li
                  key={request.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center sm:gap-4">
                    <span
                      aria-hidden="true"
                      className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-maroon/[0.07] text-maroon"
                    >
                      <Icon className="size-5" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <p id={titleId} className="text-[0.9375rem] leading-snug font-medium text-maroon">
                        {request.title}
                      </p>
                      <p className="mt-0.5 text-sm text-text-gray">{typeLabels[request.type]}</p>
                    </div>
                  </div>

                  {/* Date, status and action: wrap under the title on phones, aligned columns from sm */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-[3.25rem] sm:grid sm:grid-cols-[6.5rem_6.5rem_8.5rem] sm:gap-4 sm:pl-0">
                    <time dateTime={request.createdAt} className="text-sm whitespace-nowrap text-text-gray">
                      {formatDate(request.createdAt)}
                    </time>
                    <div>
                      <StatusBadge status={request.status} />
                    </div>
                    <div className="sm:text-right">
                      {request.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-describedby={titleId}
                          onClick={(event) => {
                            cancelTriggerRef.current = event.currentTarget
                            setPendingCancel(request)
                          }}
                        >
                          {content.cancelButton}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Screen-reader announcement after cancelling */}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <ConfirmDialog
        open={pendingCancel !== null}
        title={content.cancelDialog.title}
        description={content.cancelDialog.text}
        cancelLabel={content.cancelDialog.keep}
        confirmLabel={content.cancelDialog.confirm}
        onConfirm={confirmCancel}
        onCancel={keepRequest}
      />
    </>
  )
}
