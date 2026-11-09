import { Crown } from 'lucide-react'
import { adminsEn } from '../../content/admins.en'
import type { AdminRoleKey } from '../../content/types'

/**
 * An administrator's role. Admin looks like the Staff permission badges (light gold, maroon text
 * 11.63:1); Super Admin is maroon with off-white text (about 16:1) and a crown, so the two are told
 * apart by more than colour.
 */
export function AdminRoleBadge({ role, className = '' }: { role: AdminRoleKey; className?: string }) {
  const base = 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap'
  if (role === 'superAdmin') {
    return (
      <span className={`${base} bg-maroon text-offwhite ${className}`}>
        <Crown aria-hidden="true" className="size-3.5 text-gold-light" strokeWidth={2} />
        {adminsEn.roles.superAdmin}
      </span>
    )
  }
  return <span className={`${base} bg-gold-light/60 text-maroon ${className}`}>{adminsEn.roles.admin}</span>
}
