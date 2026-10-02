import { Building2, FileText, KeyRound, type LucideIcon } from 'lucide-react'
import { icons } from '../components/icons'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { StatusBadge } from '../components/ui/StatusBadge'
import { dashboardEn } from '../content/app.en'
import type { DashboardContent } from '../content/types'
import { currentUser } from '../data/mock/currentUser'
import { getDashboardStats, recentActivity } from '../data/mock/dashboard'
import type { ActivityKind } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useRequests } from '../state/requestsContext'

/** Icon for each kind of activity item. */
const activityIcons: Record<ActivityKind, LucideIcon> = {
  accessRequest: KeyRound,
  departmentMembership: Building2,
  sopRequest: FileText,
}

/** Morning 05:00–11:59, afternoon 12:00–16:59, evening otherwise (local time). */
function getGreeting(greetings: DashboardContent['greetings'], date = new Date()) {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return greetings.morning
  if (hour >= 12 && hour < 17) return greetings.afternoon
  return greetings.evening
}

/** Dashboard ("/dashboard") — the same for every user. */
export function DashboardPage() {
  const content = dashboardEn
  useDocumentTitle(content.pageTitle)

  // TODO: Use the authenticated user and API data once the backend exists.
  const user = currentUser
  const firstName = user.name.split(' ')[0]
  const greeting = getGreeting(content.greetings).replace('{name}', firstName)

  // Stats depend on the user's requests (pending count, SOP access).
  const { requests } = useRequests()
  const dashboardStats = getDashboardStats(user, requests)

  return (
    <>
      {/* Greeting */}
      <h1 className="text-2xl tracking-tight sm:text-3xl">
        {greeting}{' '}
        <span aria-hidden="true" className="font-normal">
          👋
        </span>
      </h1>
      <p className="mt-2 text-text-gray">{content.subtitle}</p>

      {/* Statistics */}
      <ul className="mt-8 grid gap-4 sm:grid-cols-3 sm:gap-5">
        {dashboardStats.map((stat, index) => {
          const meta = content.stats[stat.key]
          return (
            <li key={stat.key}>
              <StatCard
                icon={icons[meta.icon]}
                value={stat.value}
                label={meta.label}
                sublabel={meta.sublabel}
                tone={index % 2 === 0 ? 'maroon' : 'gold'}
                className="h-full"
              />
            </li>
          )
        })}
      </ul>

      <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-3">
        {/* Recent activity (about two-thirds) */}
        <Card title={content.recentActivity.title} titleId="recent-activity-title" className="lg:col-span-2">
          <ul className="divide-y divide-beige">
            {recentActivity.map((item) => {
              const Icon = activityIcons[item.kind]
              return (
                <li key={item.id} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0 sm:gap-4">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-beige text-maroon"
                  >
                    <Icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug font-medium text-maroon sm:text-[0.9375rem]">{item.message}</p>
                    <p className="mt-1 text-xs text-text-gray sm:text-sm">{item.timeAgo}</p>
                  </div>
                  {item.status && <StatusBadge status={item.status} className="mt-0.5" />}
                </li>
              )
            })}
          </ul>
        </Card>

        {/* Quick actions (about one-third) */}
        <Card title={content.quickActions.title} titleId="quick-actions-title">
          <ul className="space-y-3">
            <li>
              <Button to={content.quickActions.primary.href} withArrow className="w-full">
                {content.quickActions.primary.label}
              </Button>
            </li>
            {content.quickActions.secondary.map((action) => (
              <li key={action.href}>
                <Button to={action.href} variant="secondary" withArrow className="w-full">
                  {action.label}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
