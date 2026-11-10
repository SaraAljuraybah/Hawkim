import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ListChecks } from 'lucide-react'
import { ReviewTaskList } from '../components/reviews/ReviewTaskList'
import { Pagination } from '../components/ui/Pagination'
import { Tabs, type TabItem } from '../components/ui/Tabs'
import { tabIds } from '../components/ui/tabIds'
import { ViewToggle, type ViewMode } from '../components/ui/ViewToggle'
import { paginationEn } from '../content/pagination.en'
import { reviewsEn } from '../content/reviews.en'
import type { ReviewTabKey } from '../content/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useDeadlineClock } from '../hooks/useDeadlineClock'
import { nextExpiryAt } from '../lib/internalReview'
import { hasAnyPermission, hasPermission } from '../lib/permissions'
import { clampPage, pageCount, pageSlice, tabSwitch, updateParams } from '../lib/pagination'
import {
  APPROVAL_TABS, APPROVALS_URL_NAMES, readReviewsUrl, REVIEWER_TABS, REVIEWS_URL_DEFAULTS, reviewTasks, reviewerTaskSection, sortRecent, sortTodo,
  type ReviewerTaskSection,
} from '../lib/reviews'
import { useCurrentUser } from '../state/sessionContext'
import { useSops } from '../state/sopsContext'
import { NotFoundPage } from './NotFoundPage'

const VIEW_STORAGE_KEY = 'hawkim.reviews.view'

function readStoredView(): ViewMode {
  try { return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid' }
  catch { return 'grid' }
}

/**
 * Reviewer requests and approval assignments share one route and one view preference. Each list
 * has 12 per page; its tab and page are in the URL (`tab`/`page`, `approvals`/`approvalsPage`), and
 * each tab opens on the page it was left on.
 */
export function ReviewsPage() {
  const text = reviewsEn.list
  const user = useCurrentUser()
  const allowed = hasAnyPermission(user, ['reviewer', 'approver'])
  const canReview = hasPermission(user, 'reviewer')
  const canApprove = hasPermission(user, 'approver')
  useDocumentTitle(allowed ? text.pageTitle : undefined)
  const { sops } = useSops()
  const [params, setParams] = useSearchParams()
  const { tab, page: urlPage, approvalTab, approvalPage: urlApprovalPage } = useMemo(() => readReviewsUrl(params), [params])
  // The page each other tab was left on, while the user stays on this page (the URL holds only the current tab's).
  const [reviewTabPages, setReviewTabPages] = useState<Partial<Record<ReviewerTaskSection, number>>>({})
  const [approvalTabPages, setApprovalTabPages] = useState<Partial<Record<ReviewTabKey, number>>>({})
  const [view, setView] = useState<ViewMode>(readStoredView)
  useEffect(() => {
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, view) } catch { /* Storage is optional. */ }
  }, [view])

  const nextExpiry = nextExpiryAt(sops)
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

  // A page that's too high (an old link, or after a task moved to another tab) shows the last page.
  const reviewPages = pageCount(reviews.length)
  const reviewPage = clampPage(urlPage, reviewPages)
  const approvalPages = pageCount(approvals.length)
  const approvalPage = clampPage(urlApprovalPage, approvalPages)

  if (!allowed) return <NotFoundPage embedded />
  const reviewIds = tabIds('reviews', tab)
  const approvalIds = tabIds('review-approvals', approvalTab)

  // Each tab opens on the page it was left on.
  function selectTab(next: ReviewerTaskSection) {
    if (next === tab) return
    const switched = tabSwitch(params, reviewTabPages, tab, reviewPage, next, REVIEWS_URL_DEFAULTS)
    setReviewTabPages(switched.pages)
    setParams(switched.params, { replace: true })
  }
  function selectApprovalTab(next: ReviewTabKey) {
    if (next === approvalTab) return
    const switched = tabSwitch(params, approvalTabPages, approvalTab, approvalPage, next, REVIEWS_URL_DEFAULTS, APPROVALS_URL_NAMES)
    setApprovalTabPages(switched.pages)
    setParams(switched.params, { replace: true })
  }
  // A new page (a history entry): back to the top of that list, with focus on it, so keyboard and screen-reader users land on the new results.
  function goToPage(name: string, next: number, panelId: string) {
    setParams((current) => updateParams(current, { [name]: next }, REVIEWS_URL_DEFAULTS))
    requestAnimationFrame(() => {
      const panel = document.getElementById(panelId)
      panel?.scrollIntoView({ block: 'start' })
      panel?.focus({ preventScroll: true })
    })
  }

  const tabs: TabItem<ReviewerTaskSection>[] = REVIEWER_TABS.map((key) => ({ key, label: text.reviewerTabs[key] }))
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
        <Tabs items={tabs} selected={tab} onSelect={selectTab} label={text.tabsLabel} idPrefix="reviews" />
      </div>
      <div role="tabpanel" id={reviewIds.panel} aria-labelledby={reviewIds.tab} tabIndex={0} className="mt-6 rounded-xl">
        {reviews.length ? <ReviewTaskList tasks={pageSlice(reviews, reviewPage)} view={view} label={text.reviewerListLabel} /> : <EmptyTasks message={text.reviewerEmpty[tab]} />}
      </div>
      <Pagination page={reviewPage} count={reviewPages} total={reviews.length} onChange={(next) => goToPage('page', next, reviewIds.panel)} content={{ ...paginationEn, label: text.reviewerPaginationLabel }} className="mt-8" />
    </section>}

    {canApprove && <section aria-labelledby="review-approvals-heading" className={canReview ? 'mt-10' : 'mt-4'}>
      <h2 id="review-approvals-heading" className="text-xl font-medium tracking-tight">{text.approvalsTitle}</h2>
      <p className="mt-1 text-sm text-text-gray">{text.approvalsDescription}</p>
      <div className="mt-5 overflow-x-auto border-b border-beige">
        <Tabs items={approvalTabs} selected={approvalTab} onSelect={selectApprovalTab} label={text.approvalTabsLabel} idPrefix="review-approvals" />
      </div>
      <div role="tabpanel" id={approvalIds.panel} aria-labelledby={approvalIds.tab} tabIndex={0} className="mt-6 rounded-xl">
        {approvals.length ? <ReviewTaskList tasks={pageSlice(approvals, approvalPage)} view={view} label={text.approvalListLabel} /> : <EmptyTasks message={text.empty[approvalTab]} />}
      </div>
      <Pagination page={approvalPage} count={approvalPages} total={approvals.length} onChange={(next) => goToPage(APPROVALS_URL_NAMES.page, next, approvalIds.panel)} content={{ ...paginationEn, label: text.approvalPaginationLabel }} className="mt-8" />
    </section>}
  </>
}

function EmptyTasks({ message }: { message: string }) {
  return <div className="flex flex-col items-center rounded-xl border border-dashed border-beige bg-white px-6 py-14 text-center">
    <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-lg bg-beige text-maroon"><ListChecks className="size-6" strokeWidth={1.75} /></span>
    <p className="mt-4 text-text-gray">{message}</p>
  </div>
}
