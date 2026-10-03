import { sops } from './sops'
import type { ActivityItem, DashboardStat, Department, UserRequest } from './types'

/*
 * Sample dashboard data (from the approved design).
 * TODO: Replace with data from the backend API.
 */

/**
 * Dashboard statistics, derived from the other data so every screen agrees.
 * "My Requests" is personal; "SOPs" and "Employees" are for the active department.
 * @param requests the user's requests (from the requests store)
 * @param activeDepartment the department the user is working in
 */
export function getDashboardStats(requests: UserRequest[], activeDepartment: Department): DashboardStat[] {
  return [
    // "In Progress": the user's pending requests
    { key: 'myRequests', value: requests.filter((request) => request.status === 'pending').length },
    // "In this department": SOPs of the active department
    { key: 'sops', value: sops.filter((sop) => sop.departmentId === activeDepartment.id).length },
    // "In this department": members of the active department
    { key: 'employees', value: activeDepartment.memberCount },
  ]
}

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
    message: 'Your access request to Pharmacovigilance was approved',
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
