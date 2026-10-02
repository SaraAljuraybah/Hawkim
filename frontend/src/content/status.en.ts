/*
 * English labels for workflow statuses.
 * Same pattern as the other content files; an Arabic version can be added later.
 */

import type { Status } from '../types/status'

export const statusLabelsEn: Record<Status, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}
