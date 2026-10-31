/*
 * English content for the Departments page.
 * Same pattern as the other content files — no hard-coded text in components.
 * The departments themselves come from the database (src/state/DepartmentsProvider.tsx).
 */

import type { DepartmentsContent } from './types'

export const departmentsEn: DepartmentsContent = {
  pageTitle: 'Departments | Hawkim',
  title: 'Departments',
  subtitle: 'Explore departments and their functions.',
  memberCount: {
    one: '{count} member',
    other: '{count} members',
  },
  states: {
    current: 'Currently Viewing',
    member: 'Home Department',
    directoryAccess: 'Directory Access (Read-only)',
    open: 'Open SOP Directory',
    accessRequested: 'Access Requested',
    requestAccess: 'Request Access',
  },
}
