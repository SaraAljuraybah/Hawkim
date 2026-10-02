import { Lock } from 'lucide-react'
import type { SopsContent } from '../../content/types'
import type { Sop } from '../../data/mock/types'
import { requestDepartmentAccessPath } from '../../lib/routes'
import type { SopAccess } from '../../lib/sopAccess'
import { Button } from '../ui/Button'
import { StatusBadge } from '../ui/StatusBadge'

interface SopAccessIndicatorProps {
  sop: Sop
  access: SopAccess
  labels: SopsContent['access']
  /** Put the label above the button (for narrow table cells). */
  stacked?: boolean
  className?: string
}

/**
 * Shown for SOPs the user can't open:
 * - locked:    lock icon + "Restricted" and a "Request access" button (prefilled request form)
 * - requested: "Access requested" + Pending badge
 * Renders nothing for granted SOPs. Text is always shown, never colour alone.
 */
export function SopAccessIndicator({ sop, access, labels, stacked = false, className = '' }: SopAccessIndicatorProps) {
  if (access === 'granted') return null

  if (access === 'requested') {
    return (
      <div
        className={`flex gap-2 text-sm text-text-gray ${stacked ? 'flex-col items-start' : 'flex-wrap items-center'} ${className}`}
      >
        <span className={stacked ? '' : 'whitespace-nowrap'}>{labels.accessRequested}</span>
        <StatusBadge status="pending" />
      </div>
    )
  }

  return (
    <div
      className={`flex gap-x-3 gap-y-2 ${
        stacked ? 'flex-col items-start' : 'flex-wrap items-center justify-between'
      } ${className}`}
    >
      <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap text-text-gray">
        <Lock aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
        {labels.restricted}
      </span>
      <Button to={requestDepartmentAccessPath(sop.departmentId)} size="sm" variant="secondary">
        {labels.requestAccess}
      </Button>
    </div>
  )
}
