import { departments } from './departments'
import { sops } from './sops'
import type { ActivityItem, DashboardStat } from './types'

/*
 * Sample dashboard data (from the approved design).
 * TODO: Replace with data from the backend API.
 */

export const dashboardStats: DashboardStat[] = [
  { key: 'myRequests', value: 5 },
  // Derived from the mock lists so the dashboard and the other pages always agree.
  { key: 'sops', value: sops.length },
  // Sum of department members (assumes each person belongs to one department).
  { key: 'employees', value: departments.reduce((total, department) => total + department.memberCount, 0) },
]

export const recentActivity: ActivityItem[] = [
  {
    id: 'activity-1',
    kind: 'accessRequest',
    message: 'Your access request to Research & Development is under review',
    timeAgo: '2 hours ago',
    status: 'pending',
  },
  {
    id: 'activity-2',
    kind: 'departmentMembership',
    message: 'You were added to the Quality Assurance department',
    timeAgo: '1 day ago',
  },
  {
    id: 'activity-3',
    kind: 'sopRequest',
    message: 'Your request to access SOP-045 is under review',
    timeAgo: '2 days ago',
    status: 'pending',
  },
]
