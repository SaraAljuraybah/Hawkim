import { Crown } from 'lucide-react'
import { adminsEn } from '../../content/admins.en'
import type { AdminRoleKey } from '../../content/types'

interface AdminRoleBadgeProps {
  role: AdminRoleKey
  className?: string
  tone?: 'default' | 'gold'
  /**
   * Makes the badge focusable and described by this element (a Tooltip's id), so keyboard and screen-reader
   * users reach the explanation too. It stays text, not a button.
   */
  describedBy?: string
}

/**
 * An administrator's permission (Admin or Super Admin). By default, Admin looks like the Staff permission
 * badges (light gold, maroon text 11.63:1) and Super Admin is maroon with off-white text (about 16:1)
 * and a crown, so the two are told apart by more than colour.
 *
 * `tone="gold"` (the Permission row of an Admin's details) shows both in the solid light gold of the
 * staff permission badges (maroon text 8.84:1); the Super Admin keeps its crown.
 */
export function AdminRoleBadge({ role, className = '', tone = 'default', describedBy }: AdminRoleBadgeProps) {
  const base = 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap'
  const focusable = describedBy ? { tabIndex: 0, 'aria-describedby': describedBy } : {}
  if (tone === 'gold') {
    return (
      <span className={`${base} bg-gold-light px-2 text-maroon ${className}`} {...focusable}>
        {role === 'superAdmin' && <Crown aria-hidden="true" className="size-3.5" strokeWidth={2} />}
        {adminsEn.roles[role]}
      </span>
    )
  }
  if (role === 'superAdmin') {
    return (
      <span className={`${base} bg-maroon text-offwhite ${className}`} {...focusable}>
        <Crown aria-hidden="true" className="size-3.5 text-gold-light" strokeWidth={2} />
        {adminsEn.roles.superAdmin}
      </span>
    )
  }
  return <span className={`${base} bg-gold-light/60 text-maroon ${className}`} {...focusable}>{adminsEn.roles.admin}</span>
}
