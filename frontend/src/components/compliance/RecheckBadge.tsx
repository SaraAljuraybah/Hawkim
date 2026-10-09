import { RefreshCw } from 'lucide-react'

/** "Recheck recommended": amber, with an icon and text (never colour alone). */
export function RecheckBadge({ label, className = '' }: { label: string; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/20 bg-status-pending-bg px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-status-pending-fg ${className}`}
    >
      <RefreshCw aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
      {label}
    </span>
  )
}
