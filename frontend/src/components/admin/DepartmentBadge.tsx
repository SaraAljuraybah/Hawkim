import { departmentAbbreviation } from '../../lib/departmentInitials'

/**
 * The department's abbreviation in a circle, generated from its name (lib/departmentInitials.ts), so it
 * follows a rename. Decorative: the name is always shown next to it.
 */
export function DepartmentBadge({ department, className = '' }: { department: { name: string }; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-maroon/[0.07] text-xs font-semibold text-maroon ${className}`}
    >
      {departmentAbbreviation(department.name)}
    </span>
  )
}
