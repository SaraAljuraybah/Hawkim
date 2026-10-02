import type { UserRequest } from './types'

/*
 * Sample requests to the admin team (from the approved design).
 * These seed the in-memory requests store (src/state/).
 * TODO: Replace with data from the backend API.
 */
export const mockRequests: UserRequest[] = [
  {
    id: 'req-004',
    title: 'Access to Regulatory Affairs',
    type: 'department-access',
    departmentId: 'regulatory-affairs',
    description: 'I need to view Regulatory Affairs SOPs to support an upcoming submission.',
    createdAt: '2024-01-12',
    status: 'pending',
  },
  {
    id: 'req-003',
    title: 'Permission Change (SOP Edit)',
    type: 'permission-change',
    description: 'Requesting edit permission for SOPs in my department so I can update draft procedures.',
    createdAt: '2024-01-10',
    status: 'approved',
  },
  {
    id: 'req-002',
    title: 'New Department Access (PV)',
    type: 'department-access',
    departmentId: 'pharmacovigilance',
    description: 'I need access to Pharmacovigilance SOPs to support safety reporting work.',
    createdAt: '2024-01-05',
    status: 'approved',
  },
  {
    id: 'req-001',
    title: 'System Role Update',
    type: 'role-change',
    description: 'Please update my system role to match my new responsibilities.',
    createdAt: '2024-01-03',
    status: 'pending',
  },
]
