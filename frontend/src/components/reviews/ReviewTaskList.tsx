import { FileText } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ViewMode } from '../ui/ViewToggle'
import { StatusBadge } from '../ui/StatusBadge'
import { ReviewerDeadline } from '../workflow/ReviewerDeadline'
import { RequestStatusBadge, ReviewRequestDetails } from '../workflow/ReviewRequestDetails'
import { reviewsEn } from '../../content/reviews.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import { useDeadlineClock } from '../../hooks/useDeadlineClock'
import { formatDate, formatDateTime } from '../../lib/format'
import { isInternalReviewTask, type ReviewTask } from '../../lib/reviews'
import { reviewPath } from '../../lib/routes'
import { useDepartments } from '../../state/departmentsContext'
import { useUsers } from '../../state/usersContext'

const pill = 'inline-flex w-fit items-center rounded-full border border-maroon/20 bg-maroon/[0.06] px-2 py-0.5 text-xs font-medium text-maroon'
const focusRing = 'has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-3 has-[a:focus-visible]:outline-maroon-secondary has-[a:focus-visible]:outline-solid'

/** One markup tree for both views: changing the view never changes task grouping or access. */
export function ReviewTaskList({ tasks, view, label }: { tasks: ReviewTask[]; view: ViewMode; label: string }) {
  const text = reviewsEn.list
  const { nameOf } = useUsers()
  const { nameOf: departmentName } = useDepartments()
  const grid = view === 'grid'
  return <ul aria-label={label} className={grid ? 'grid gap-5 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4' : 'space-y-3'}>
    {tasks.map((task) => <li key={task.sop.id}>
      <article className={`relative flex h-full gap-4 rounded-xl border border-beige bg-white p-5 transition-colors hover:border-maroon/30 ${focusRing} ${grid ? 'flex-col sm:p-6' : 'flex-col md:flex-row md:items-start md:gap-6'}`}>
        <span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-maroon/[0.07] text-maroon"><FileText className="size-5" strokeWidth={1.75} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base leading-snug font-medium text-maroon"><Link to={reviewPath(task.sop.id)} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">{task.sop.title}</Link></h3>
          <p className="mt-2 text-sm text-text-gray">{text.author.replace('{name}', nameOf(task.sop.authorId))}</p>
          <p className="mt-1 text-sm text-text-gray">{departmentName(task.sop.departmentId)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={task.sop.status} />
            {task.need && <span className={pill}>{text.needs[task.need]}</span>}
            {task.group === 'waiting' && <span className={pill}>{text.waiting}</span>}
          </div>
          <p className="mt-3 text-xs text-text-gray">{text.yourRole.replace('{role}', text.roles[task.role])}</p>
        </div>
        <div className={grid ? 'mt-auto border-t border-beige pt-4' : 'border-t border-beige pt-4 md:w-64 md:shrink-0 md:border-t-0 md:border-l md:pt-0 md:pl-5'}>
          <TaskDetails task={task} />
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-gray">
            <span>{text.version.replace('{version}', task.sop.version)}</span>
            <span>{text.updated.split('{date}')[0]}<time dateTime={task.sop.lastUpdated}>{formatDate(task.sop.lastUpdated)}</time>{text.updated.split('{date}')[1]}</span>
          </p>
        </div>
      </article>
    </li>)}
  </ul>
}

function TaskDetails({ task }: { task: ReviewTask }) {
  const text = reviewsEn.list
  if (task.role === 'reviewer' && isInternalReviewTask(task)) return <>
    <RequestStatusBadge sop={task.sop} request={task.reviewer} inactive={task.group === 'done'} />
    {task.group === 'done' && ['pending', 'accepted'].includes(task.decision) && <span className={`ml-2 ${pill}`}>{text.closed}</span>}
    <ReviewRequestDetails sop={task.sop} request={task.reviewer} inactive={task.group === 'done'} />
  </>
  return <>
    <span className={pill}>{text.decisions[task.decision] ?? text.closed}</span>
    {task.role === 'reviewer' && task.reviewer && <ReviewerDeadline sop={task.sop} reviewer={task.reviewer} content={sopWorkflowEn.reviewerDeadline} showQueue inactive={task.group === 'done'} />}
    {task.role === 'approver' && task.group === 'todo' && <ApprovalDeadline task={task} />}
    {task.decidedAt && <p className="mt-1 text-xs text-text-gray"><time dateTime={task.decidedAt}>{formatDateTime(task.decidedAt)}</time></p>}
  </>
}

function ApprovalDeadline({ task }: { task: ReviewTask }) {
  const text = reviewsEn.list
  const now = useDeadlineClock(task.dueAt, task.group === 'todo')
  const overdue = !!task.dueAt && new Date(task.dueAt).getTime() <= now
  return <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-gray">
    {task.dueAt ? <span>{text.due.split('{date}')[0]}<time dateTime={task.dueAt}>{formatDateTime(task.dueAt)}</time>{text.due.split('{date}')[1]}</span> : <span>{text.noDueDate}</span>}
    {overdue && <span className="font-semibold text-status-rejected-fg">{text.overdue}</span>}
  </p>
}
