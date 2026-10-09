import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { Tabs, type TabItem } from '../../components/ui/Tabs'
import { tabIds } from '../../components/ui/tabIds'
import { TextField } from '../../components/ui/TextField'
import { adminEn } from '../../content/admin.en'
import { requestsEn } from '../../content/requests.en'
import type { AdminRequestTabKey } from '../../content/types'
import type { UserRequest } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { formatCount } from '../../lib/count'
import { formatDate } from '../../lib/format'
import { adminRequestPath } from '../../lib/routes'
import { useDepartments } from '../../state/departmentsContext'
import { useRequests } from '../../state/requestsContext'
import { useUsers } from '../../state/usersContext'

const TAB_ID_PREFIX = 'admin-requests'
const TABS: AdminRequestTabKey[] = ['pending', 'approved', 'rejected', 'cancelled', 'all']

/* One link per row, stretched over the whole row with ::after (as in the other lists). */
const stretchedLink = 'after:absolute after:inset-0 focus-visible:outline-none'
const focusRing =
  'has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-maroon-secondary has-[a:focus-visible]:outline-solid'

/** When it was sent: the time when known (requests sent in the app), otherwise the date. */
const sentAt = (request: UserRequest) => request.submittedAt ?? request.createdAt

/** The tab's requests: Pending oldest first (waiting longest on top), the others newest first. */
function inTab(tab: AdminRequestTabKey, requests: UserRequest[]): UserRequest[] {
  const visible = tab === 'all' ? requests : requests.filter((request) => request.status === tab)
  return [...visible].sort((a, b) =>
    tab === 'pending' ? sentAt(a).localeCompare(sentAt(b)) : sentAt(b).localeCompare(sentAt(a)),
  )
}

/** Requests ("/admin/requests", PBI 33): every user's requests by status, with search. */
export function AdminRequestsPage() {
  const content = adminEn.requestsList
  useDocumentTitle(adminEn.pageTitle.replace('{page}', content.title))
  const { requests } = useRequests()
  const { getUser, nameOf } = useUsers()
  const { nameOf: departmentName } = useDepartments()

  const [tab, setTab] = useState<AdminRequestTabKey>('pending')
  const [query, setQuery] = useState('')
  const ids = tabIds(TAB_ID_PREFIX, tab)
  const tabItems: TabItem<AdminRequestTabKey>[] = TABS.map((key) => ({ key, label: content.tabs[key] }))

  const inThisTab = useMemo(() => inTab(tab, requests), [tab, requests])
  const visible = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return inThisTab
    return inThisTab.filter(
      (request) =>
        request.title.toLowerCase().includes(text) || (getUser(request.requesterId)?.name ?? '').toLowerCase().includes(text),
    )
  }, [inThisTab, query, getUser])

  const departmentOf = (request: UserRequest) =>
    request.type === 'department-access' ? departmentName(request.departmentId) : content.noDepartment
  const requesterDepartment = (request: UserRequest) => departmentName(getUser(request.requesterId)?.departmentId)
  const submitted = (request: UserRequest) => (
    <time dateTime={request.createdAt} className="whitespace-nowrap">
      {formatDate(request.createdAt)}
    </time>
  )

  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{content.subtitle}</p>

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
        <TextField
          name="search"
          type="search"
          label={content.search.label}
          placeholder={content.search.placeholder}
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-md"
        />

        {/* Announced as the results change */}
        <p role="status" className="mt-6 text-sm font-medium text-text-gray">
          {formatCount(visible.length, content.count)}
        </p>

        {visible.length === 0 ? (
          <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed border-beige bg-white px-6 py-14 text-center">
            <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-lg bg-beige text-maroon">
              <ClipboardList className="size-6" strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-text-gray">{inThisTab.length === 0 ? content.empty[tab] : content.noMatches}</p>
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-xl border border-beige bg-white">
            {/* Table — xl and up (scrolls inside its own box if it is ever too wide) */}
            <div className="hidden overflow-x-auto xl:block">
              <table aria-label={content.tableLabel} className="w-full text-left text-sm">
                <thead className="bg-beige/60 text-maroon">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-semibold">{content.columns.requester}</th>
                    <th scope="col" className="px-5 py-3 font-semibold">{content.columns.title}</th>
                    <th scope="col" className="px-5 py-3 font-semibold">{content.columns.type}</th>
                    <th scope="col" className="px-5 py-3 font-semibold">{content.columns.department}</th>
                    <th scope="col" className="px-5 py-3 font-semibold">{content.columns.submitted}</th>
                    <th scope="col" className="px-5 py-3 font-semibold">{content.columns.status}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-beige">
                  {visible.map((request) => (
                    <tr key={request.id} className={`relative transition-colors hover:bg-beige/40 ${focusRing}`}>
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-maroon">{nameOf(request.requesterId)}</p>
                        <p className="text-text-gray">{requesterDepartment(request)}</p>
                      </td>
                      <th scope="row" className="px-5 py-3.5 font-medium text-maroon">
                        <Link to={adminRequestPath(request.id)} className={stretchedLink}>
                          {request.title}
                        </Link>
                      </th>
                      <td className="px-5 py-3.5 text-text-gray">{requestsEn.types[request.type]}</td>
                      <td className="px-5 py-3.5 text-text-gray">{departmentOf(request)}</td>
                      <td className="px-5 py-3.5 text-text-gray">{submitted(request)}</td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={request.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Stacked cards — below xl */}
            <ul aria-label={content.tableLabel} className="divide-y divide-beige xl:hidden">
              {visible.map((request) => (
                <li key={request.id} className={`relative p-4 ${focusRing}`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-sm font-medium text-maroon">
                      <Link to={adminRequestPath(request.id)} className={stretchedLink}>
                        {request.title}
                      </Link>
                    </p>
                    <StatusBadge status={request.status} />
                  </div>
                  <p className="mt-1 text-sm text-text-gray">
                    {nameOf(request.requesterId)}
                    <span aria-hidden="true"> · </span>
                    <span className="sr-only">, </span>
                    {requesterDepartment(request)}
                  </p>
                  <p className="mt-0.5 text-sm text-text-gray">
                    {requestsEn.types[request.type]}
                    {request.type === 'department-access' && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="sr-only">, {content.departmentLabel} </span>
                        {departmentOf(request)}
                      </>
                    )}
                    <span aria-hidden="true"> · </span>
                    <span className="sr-only">, </span>
                    {submitted(request)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  )
}
