/*
 * English labels for workflow statuses.
 * Same pattern as the other content files; an Arabic version can be added later.
 */

import type { BadgeStatus } from '../types/status'

export const statusLabelsEn: Record<BadgeStatus, string> = {
  // Requests
  pending: 'Pending',
  approved: 'Approved', // also the SOP lifecycle "Approved"
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  // SOP lifecycle
  draft: 'Draft',
  'in-review': 'In Review',
  returned: 'Returned',
  'in-approval': 'In Approval',
  published: 'Published',
}
