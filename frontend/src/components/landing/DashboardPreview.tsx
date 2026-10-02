import type { DashboardPreviewContent } from '../../content/types'
import { icons } from '../icons'

interface DashboardPreviewProps {
  content: DashboardPreviewContent
  className?: string
}

/**
 * Decorative preview of the Hawkim dashboard, built with HTML/CSS (not an image).
 * It is hidden from assistive technology (`aria-hidden`) and made non-interactive
 * (`inert`), because it only illustrates the product.
 */
export function DashboardPreview({ content, className = '' }: DashboardPreviewProps) {
  const SignOutIcon = icons[content.signOut.icon]

  return (
    <div
      aria-hidden="true"
      inert
      className={`overflow-hidden rounded-2xl border border-beige bg-white shadow-[0_32px_64px_-32px_rgba(58,11,24,0.35)] select-none ${className}`}
    >
      {/* Window title bar */}
      <div className="flex h-9 items-center gap-1.5 border-b border-beige bg-beige/60 px-4">
        <span className="size-2.5 rounded-full bg-maroon/20" />
        <span className="size-2.5 rounded-full bg-maroon/20" />
        <span className="size-2.5 rounded-full bg-maroon/20" />
        <span className="ml-3 text-[11px] font-medium text-text-gray">{content.windowTitle}</span>
      </div>

      <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] xl:grid-cols-[10rem_minmax(0,1fr)]">
        {/* Sidebar */}
        <div className="flex flex-col bg-maroon p-3">
          <ul className="space-y-1">
            {content.sidebar.map((item) => {
              const Icon = icons[item.icon]
              return (
                <li
                  key={item.label}
                  className={`relative flex items-center gap-2 rounded-md px-2.5 py-2 text-[11px] font-medium ${
                    item.active ? 'bg-offwhite/10 text-offwhite' : 'text-beige/80'
                  }`}
                >
                  {item.active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gold" />}
                  <Icon className={`size-3.5 shrink-0 ${item.active ? 'text-gold' : ''}`} strokeWidth={1.75} />
                  {item.label}
                </li>
              )
            })}
          </ul>
          <div className="mt-auto flex items-center gap-2 border-t border-offwhite/10 px-2.5 pt-3 text-[11px] font-medium text-beige/80">
            <SignOutIcon className="size-3.5 shrink-0" strokeWidth={1.75} />
            {content.signOut.label}
          </div>
        </div>

        {/* Main area */}
        <div className="space-y-4 bg-offwhite p-4 xl:p-5">
          <p className="text-base font-semibold text-maroon">{content.greeting}</p>

          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-2.5">
            {content.stats.map((stat) => {
              const Icon = icons[stat.icon]
              return (
                <div key={stat.label} className="rounded-lg border border-beige bg-white p-3">
                  <div className="flex items-start justify-between">
                    <span className="text-2xl leading-none font-semibold text-maroon">{stat.value}</span>
                    <Icon className="size-4 text-gold" strokeWidth={1.75} />
                  </div>
                  <p className="mt-2 text-[11px] font-medium text-maroon">{stat.label}</p>
                  <p className="mt-0.5 text-[10px] leading-snug text-text-gray">{stat.caption}</p>
                </div>
              )
            })}
          </div>

          <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {/* Recent activity */}
            <div className="rounded-lg border border-beige bg-white p-3">
              <p className="mb-2 text-[11px] font-semibold text-maroon">{content.recentActivity.title}</p>
              <ul className="divide-y divide-beige">
                {content.recentActivity.items.map((item) => (
                  <li key={item.title} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium text-maroon">{item.title}</p>
                      <p className="text-[10px] text-text-gray">{item.meta}</p>
                    </div>
                    <span className="shrink-0 rounded-full border border-gold-light bg-gold-light/25 px-2 py-0.5 text-[10px] font-medium text-maroon-secondary">
                      {item.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Quick actions */}
            <div className="rounded-lg border border-beige bg-white p-3">
              <p className="mb-2 text-[11px] font-semibold text-maroon">{content.quickActions.title}</p>
              <ul className="space-y-1.5">
                {content.quickActions.items.map((action) => {
                  const Icon = icons[action.icon]
                  return (
                    <li
                      key={action.label}
                      className="flex items-center gap-2 rounded-md border border-beige px-2.5 py-2 text-[11px] font-medium text-maroon"
                    >
                      <Icon className="size-3.5 shrink-0 text-maroon-secondary" strokeWidth={1.75} />
                      {action.label}
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
