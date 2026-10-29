import { useEffect, useMemo, useState } from 'react'
import { ListChecks } from 'lucide-react'
import { ReviewTaskList } from '../components/reviews/ReviewTaskList'
import { Tabs, type TabItem } from '../components/ui/Tabs'
import { tabIds } from '../components/ui/tabIds'
import { ViewToggle, type ViewMode } from '../components/ui/ViewToggle'
import { reviewsEn } from '../content/reviews.en'
import type { ReviewTabKey } from '../content/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useDeadlineClock } from '../hooks/useDeadlineClock'
import { nextWithdrawalAt } from '../lib/internalReview'
import { hasAnyPermission, hasPermission } from '../lib/permissions'
import { reviewTasks, reviewerTaskSection, sortRecent, sortTodo, type ReviewerTaskSection } from '../lib/reviews'
import { useCurrentUser } from '../state/sessionContext'
import { useSops } from '../state/sopsContext'
import { NotFoundPage } from './NotFoundPage'

const REVIEW_TABS: ReviewerTaskSection[] = ['incoming', 'active', 'completed']
const APPROVAL_TABS: ReviewTabKey[] = ['todo', 'waiting', 'done']
const VIEW_STORAGE_KEY = 'hawkim.reviews.view'

function readStoredView(): ViewMode {
  try { return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid' }
  catch { return 'grid' }
}

/** Reviewer requests and approval assignments share one route and one view preference. */
export function ReviewsPage() {
  const text = reviewsEn.list
  const user = useCurrentUser()
  const allowed = hasAnyPermission(user, ['reviewer', 'approver'])
  const canReview = hasPermission(user, 'reviewer')
  const canApprove = hasPermission(user, 'approver')
  useDocumentTitle(allowed ? text.pageTitle : undefined)
  const { sops } = useSops()
  const [tab, setTab] = useState<ReviewerTaskSection>('incoming')
  const [approvalTab, setApprovalTab] = useState<ReviewTabKey>('todo')
  const [view, setView] = useState<ViewMode>(readStoredView)
  useEffect(() => {
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, view) } catch { /* Storage is optional. */ }
  }, [view])

  const nextExpiry = nextWithdrawalAt(sops)
  const now = useDeadlineClock(nextExpiry === undefined ? undefined : new Date(nextExpiry).toISOString(), allowed)
  const tasks = useMemo(() => reviewTasks(user.id, sops, now), [user.id, sops, now])
  const reviews = useMemo(() => {
    const selected = tasks.filter((task) => task.role === 'reviewer' && reviewerTaskSection(task) === tab)
    return tab === 'completed' ? sortRecent(selected) : sortTodo(selected)
  }, [tasks, tab])
  const approvals = useMemo(() => {
    const selected = tasks.filter((task) => task.role === 'approver' && task.group === approvalTab)
    return approvalTab === 'todo' ? sortTodo(selected) : sortRecent(selected)
  }, [tasks, approvalTab])

  if (!allowed) return <NotFoundPage embedded />
  const reviewIds = tabIds('reviews', tab)
  const approvalIds = tabIds('review-approvals', approvalTab)
  const tabs: TabItem<ReviewerTaskSection>[] = REVIEW_TABS.map((key) => ({ key, label: text.reviewerTabs[key] }))
  const approvalTabs: TabItem<ReviewTabKey>[] = APPROVAL_TABS.map((key) => ({ key, label: text.tabs[key] }))

  return <>
    <h1 className="text-2xl tracking-tight sm:text-3xl">{text.title}</h1>
    <p className="mt-2 text-text-gray">{text.subtitle}</p>
    <div className="mt-6 flex justify-end">
      <ViewToggle value={view} onChange={setView} labels={text.view} />
    </div>

    {canReview && <section aria-labelledby="review-requests-heading" className="mt-4">
      <h2 id="review-requests-heading" className="sr-only">{text.reviewerListLabel}</h2>
      <div className="overflow-x-auto border-b border-beige">
        <Tabs items={tabs} selected={tab} onSelect={setTab} label={text.tabsLabel} idPrefix="reviews" />
      </div>
      <div role="tabpanel" id={reviewIds.panel} aria-labelledby={reviewIds.tab} tabIndex={0} className="mt-6 rounded-xl">
        {reviews.length ? <ReviewTaskList tasks={reviews} view={view} label={text.reviewerListLabel} /> : <EmptyTasks message={text.reviewerEmpty[tab]} />}
      </div>
    </section>}

    {canApprove && <section aria-labelledby="review-approvals-heading" className={canReview ? 'mt-10' : 'mt-4'}>
      <h2 id="review-approvals-heading" className="text-xl font-medium tracking-tight">{text.approvalsTitle}</h2>
      <p className="mt-1 text-sm text-text-gray">{text.approvalsDescription}</p>
      <div className="mt-5 overflow-x-auto border-b border-beige">
        <Tabs items={approvalTabs} selected={approvalTab} onSelect={setApprovalTab} label={text.approvalTabsLabel} idPrefix="review-approvals" />
      </div>
      <div role="tabpanel" id={approvalIds.panel} aria-labelledby={approvalIds.tab} tabIndex={0} className="mt-6 rounded-xl">
        {approvals.length ? <ReviewTaskList tasks={approvals} view={view} label={text.approvalListLabel} /> : <EmptyTasks message={text.empty[approvalTab]} />}
      </div>
    </section>}
  </>
}

function EmptyTasks({ message }: { message: string }) {
  return <div className="flex flex-col items-center rounded-xl border border-dashed border-beige bg-white px-6 py-14 text-center">
    <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-lg bg-beige text-maroon"><ListChecks className="size-6" strokeWidth={1.75} /></span>
    <p className="mt-4 text-text-gray">{message}</p>
  </div>
}
