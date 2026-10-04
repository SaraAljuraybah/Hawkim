import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListChecks } from 'lucide-react'
import { StatusBadge } from '../components/ui/StatusBadge'
import { Tabs, type TabItem } from '../components/ui/Tabs'
import { tabIds } from '../components/ui/tabIds'
import { reviewsEn } from '../content/reviews.en'
import type { ReviewTabKey } from '../content/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatDateTime } from '../lib/format'
import { hasAnyPermission } from '../lib/permissions'
import { reviewTasks, sortRecent, sortTodo, type ReviewTask } from '../lib/reviews'
import { reviewPath } from '../lib/routes'
import { isOverdue } from '../lib/workflow'
import { useDepartments } from '../state/departmentsContext'
import { useCurrentUser } from '../state/sessionContext'
import { useSops } from '../state/sopsContext'
import { useUsers } from '../state/usersContext'
import { NotFoundPage } from './NotFoundPage'

const TAB_ID_PREFIX = 'reviews'
const TABS: ReviewTabKey[] = ['todo', 'waiting', 'done']

/* Visible focus for the row that contains a focused link. */
const focusRing =
  'has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-maroon-secondary has-[a:focus-visible]:outline-solid'
const pill = 'inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap'

/**
 * My Reviews ("/reviews", PBI 7, 10, 25): every SOP the user reviews or approves, in
 * any department, by what's needed from them: To do, Waiting and Done.
 * Reviewer or Approver permission only.
 */
export function ReviewsPage() {
  const text = reviewsEn.list
  const user = useCurrentUser()
  const allowed = hasAnyPermission(user, ['reviewer', 'approver'])
  useDocumentTitle(allowed ? text.pageTitle : undefined)
  const { sops } = useSops()
  const { nameOf } = useUsers()
  const { nameOf: departmentName } = useDepartments()
  const [tab, setTab] = useState<ReviewTabKey>('todo')

  const tasks = useMemo(() => reviewTasks(user.id, sops), [user.id, sops])
  const visible = useMemo(() => {
    const inTab = tasks.filter((task) => task.group === tab)
    return tab === 'todo' ? sortTodo(inTab) : sortRecent(inTab)
  }, [tasks, tab])

  if (!allowed) return <NotFoundPage embedded />

  const ids = tabIds(TAB_ID_PREFIX, tab)
  const tabItems: TabItem<ReviewTabKey>[] = TABS.map((key) => ({ key, label: text.tabs[key] }))

  const due = (task: ReviewTask) => {
    const overdue = !!task.dueAt && isOverdue(task.sop, task.sop.status === 'in-approval' ? 'approval' : 'review')
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {task.dueAt ? (
          <span className="text-sm whitespace-nowrap text-text-gray">
            {text.due.split('{date}')[0]}
            <time dateTime={task.dueAt}>{formatDateTime(task.dueAt)}</time>
            {text.due.split('{date}')[1]}
          </span>
        ) : (
          <span className="text-sm text-text-gray">{text.noDueDate}</span>
        )}
        {overdue && <span className={`${pill} bg-status-rejected-bg text-status-rejected-fg`}>{text.overdue}</span>}
      </span>
    )
  }

  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{text.title}</h1>
      <p className="mt-2 text-text-gray">{text.subtitle}</p>

      <div className="mt-8 border-b border-beige">
        <Tabs items={tabItems} selected={tab} onSelect={setTab} label={text.tabsLabel} idPrefix={TAB_ID_PREFIX} />
      </div>

      <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} tabIndex={0} className="mt-6 rounded-xl">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-beige bg-white px-6 py-14 text-center">
            <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-lg bg-beige text-maroon">
              <ListChecks className="size-6" strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-text-gray">{text.empty[tab]}</p>
          </div>
        ) : (
          <ul aria-label={text.listLabel} className="divide-y divide-beige rounded-xl border border-beige bg-white">
            {visible.map((task) => (
              <li
                key={task.sop.id}
                className={`relative flex flex-col gap-3 p-4 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-beige/40 md:flex-row md:items-center md:gap-6 md:px-5 ${focusRing}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-maroon">{task.sop.code}</p>
                  <p className="mt-0.5 text-[0.9375rem] leading-snug font-medium text-maroon">
                    <Link to={reviewPath(task.sop.id)} className="after:absolute after:inset-0 focus-visible:outline-none">
                      {task.sop.title}
                    </Link>
                  </p>
                  <p className="mt-1 text-sm text-text-gray">
                    {text.author.replace('{name}', nameOf(task.sop.authorId))}
                    <span aria-hidden="true"> · </span>
                    <span className="sr-only">, </span>
                    {departmentName(task.sop.departmentId)}
                    <span aria-hidden="true"> · </span>
                    <span className="sr-only">, </span>
                    {text.yourRole.replace('{role}', text.roles[task.role])}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 md:w-56 md:shrink-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={task.sop.status} />
                    {task.need && (
                      <span className={`${pill} border border-maroon/20 bg-maroon/[0.06] text-maroon`}>{text.needs[task.need]}</span>
                    )}
                  </div>
                  {/* The due date is the user's own only while something is needed from them. */}
                  {task.group === 'todo' && due(task)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
