import type { Status } from '../../types/status'

/*
 * Types for the sample data in src/data/mock/.
 * These describe the data the backend API will return later, so the
 * mock files can be swapped for API calls without changing components.
 */

/** The signed-in user. */
export interface User {
  name: string
  initials: string
  department: string
}

/** Identifies each dashboard statistic (its label and icon come from the content file). */
export type DashboardStatKey = 'myRequests' | 'sops' | 'employees'

export interface DashboardStat {
  key: DashboardStatKey
  value: number
}

/** What an activity item is about; decides its icon. */
export type ActivityKind = 'accessRequest' | 'departmentMembership' | 'sopRequest'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  message: string
  /** Display string for now (e.g. "2 hours ago"); will become a timestamp from the API. */
  timeAgo: string
  /** Optional: items without a status show no badge. */
  status?: Status
}
