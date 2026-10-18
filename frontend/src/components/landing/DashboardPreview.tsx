import { ArrowRight, Bell, Building2, ChevronDown, FileText, KeyRound } from 'lucide-react'
import type { DashboardPreviewContent } from '../../content/types'
import { appShellEn } from '../../content/app.en'
import { icons } from '../icons'
import { Logo } from '../ui/Logo'

interface DashboardPreviewProps {
  content: DashboardPreviewContent
  className?: string
}

/** A compact, inert illustration of the actual dashboard for the default author account. */
export function DashboardPreview({ content, className = '' }: DashboardPreviewProps) {
  const SignOutIcon = icons[content.signOut.icon]
  const activityIcons = [KeyRound, Building2, FileText]
  return (
    <div aria-hidden="true" inert className={`overflow-hidden rounded-2xl border border-beige bg-white shadow-xl select-none @container ${className}`}>
      <div className="flex h-8 items-center gap-1.5 border-b border-beige bg-beige/60 px-3">
        {[0, 1, 2].map((dot) => <span key={dot} className="size-2 rounded-full bg-maroon/20" />)}
        <span className="ml-2 text-[10px] font-medium text-text-gray">{content.windowTitle}</span>
      </div>
      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] @lg:grid-cols-[8.5rem_minmax(0,1fr)]">
        <div className="flex flex-col bg-maroon px-2 py-3">
          <div className="mb-4 flex items-center gap-2 px-1">
            <Logo variant="markOnDark" alt="" className="h-6" />
            <span className="text-sm font-semibold text-offwhite">{appShellEn.brandName}</span>
          </div>
          <ul className="space-y-1">
            {content.sidebar.map((item) => {
              const Icon = icons[item.icon]
              return (
                <li key={item.label} className={`relative flex items-center gap-2 rounded-md px-2 py-2 text-[10px] leading-snug font-medium ${item.active ? 'bg-white/10 text-white' : 'text-beige'}`}>
                  {item.active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gold" />}
                  <Icon className="size-3.5 shrink-0 text-gold-light" strokeWidth={1.75} />
                  <span>{item.label}</span>
                </li>
              )
            })}
          </ul>
          <div className="mt-auto flex items-center gap-2 border-t border-white/10 px-2 pt-3 text-[10px] font-medium text-beige">
            <SignOutIcon className="size-3.5 text-gold-light" strokeWidth={1.75} />{content.signOut.label}
          </div>
        </div>
        <div className="min-w-0 bg-offwhite">
          <div className="flex h-12 items-center justify-end gap-2 border-b border-beige bg-white px-3">
            <Bell className="size-3.5 text-maroon" />
            <span className="h-6 w-px bg-beige" />
            <span className="flex size-6 items-center justify-center rounded-full bg-maroon text-[9px] font-semibold text-offwhite">{content.user.initials}</span>
            <div className="min-w-0 text-[9px] leading-snug">
              <p className="font-medium text-maroon">{content.user.name}</p>
              <p className="flex items-center gap-1 text-text-gray">{content.user.department}<ChevronDown className="size-2.5" /></p>
            </div>
          </div>
          <div className="space-y-3 p-3 @lg:p-4">
            <div>
              <p className="text-base font-semibold text-maroon">{content.greeting}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-text-gray">{content.subtitle}</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {content.stats.map((stat, index) => {
                const Icon = icons[stat.icon]
                return (
                  <div key={stat.label} className="flex min-w-0 items-start justify-between gap-1 rounded-lg border border-beige bg-white p-2.5">
                    <div className="min-w-0">
                      <p className="text-xl leading-none font-semibold text-maroon">{stat.value}</p>
                      <p className="mt-2 text-[10px] font-medium text-maroon">{stat.label}</p>
                      <p className="mt-1 text-[9px] leading-snug text-text-gray">{stat.caption}</p>
                    </div>
                    <span className={`hidden size-6 shrink-0 items-center justify-center rounded-md @lg:inline-flex ${index % 2 === 0 ? 'bg-maroon/[0.07] text-maroon' : 'bg-gold/15 text-maroon-secondary'}`}>
                      <Icon className="size-3.5" strokeWidth={1.75} />
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="grid gap-2 @lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] @lg:items-start">
              <div className="rounded-lg border border-beige bg-white p-2.5">
                <p className="mb-2 text-[11px] font-semibold text-maroon">{content.recentActivity.title}</p>
                <ul className="divide-y divide-beige">
                  {content.recentActivity.items.map((item, index) => {
                    const Icon = activityIcons[index % activityIcons.length]
                    return (
                      <li key={item.title} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
                        <span className="hidden size-6 shrink-0 items-center justify-center rounded-md bg-beige text-maroon @lg:inline-flex"><Icon className="size-3.5" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] leading-snug font-medium text-maroon">{item.title}</p>
                          <p className="mt-1 text-[9px] text-text-gray">{item.meta}</p>
                        </div>
                        {item.status && <span className="rounded-full bg-status-pending-bg px-1.5 py-0.5 text-[9px] font-medium text-status-pending-fg">{item.status}</span>}
                      </li>
                    )
                  })}
                </ul>
              </div>
              <div className="rounded-lg border border-beige bg-white p-2.5">
                <p className="mb-2 text-[11px] font-semibold text-maroon">{content.quickActions.title}</p>
                <ul className="space-y-2">
                  {content.quickActions.items.map((action, index) => (
                    <li key={action.label} className={`flex items-center justify-center gap-1 rounded-md border px-2 py-2 text-center text-[10px] leading-snug font-medium ${index === 0 ? 'border-maroon bg-maroon text-offwhite' : 'border-maroon/40 text-maroon'}`}>
                      {action.label}<ArrowRight className="size-3 shrink-0" />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
