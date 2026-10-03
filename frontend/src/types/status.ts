/** Statuses of requests to the admin team. */
export type Status = 'pending' | 'approved' | 'rejected' | 'cancelled'

/**
 * SOP lifecycle: Draft → In Review → (Returned) → In Approval → Approved → Published.
 */
export type SopStatus = 'draft' | 'in-review' | 'returned' | 'in-approval' | 'approved' | 'published'

/** Anything a StatusBadge can show. */
export type BadgeStatus = Status | SopStatus
