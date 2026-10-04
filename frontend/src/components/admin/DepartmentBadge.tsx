import type { Department } from '../../data/mock/types'

/** The department's initials in a circle (decorative: the name is always shown next to it). */
export function DepartmentBadge({ department, className = '' }: { department: Department; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-maroon/[0.07] text-xs font-semibold text-maroon ${className}`}
    >
      {department.initials}
    </span>
  )
}
