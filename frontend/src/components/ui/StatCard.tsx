import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  icon: LucideIcon
  value: number | string
  label: string
  sublabel?: string
  /** Icon tint: brand maroon or brand gold. */
  tone?: 'maroon' | 'gold'
  className?: string
}

const tones = {
  maroon: 'bg-maroon/[0.07] text-maroon',
  gold: 'bg-gold/15 text-maroon-secondary',
}

/**
 * Single statistic: icon, number, label and optional sublabel.
 * In the DOM the label comes before the number, so screen readers announce
 * "My Requests, 5, In Progress"; visually the number is shown first.
 */
export function StatCard({ icon: Icon, value, label, sublabel, tone = 'maroon', className = '' }: StatCardProps) {
  return (
    <div className={`flex items-start justify-between gap-4 rounded-xl border border-beige bg-white p-5 sm:p-6 ${className}`}>
      <div className="flex min-w-0 flex-col">
        <p className="mt-2 text-sm font-medium text-maroon">{label}</p>
        <p className="order-first text-3xl leading-none font-semibold text-maroon">{value}</p>
        {sublabel && <p className="mt-1 text-sm text-text-gray">{sublabel}</p>}
      </div>
      <span
        aria-hidden="true"
        className={`inline-flex size-11 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}
      >
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
    </div>
  )
}
