/*
 * English content for the Departments page.
 * Same pattern as the other content files — no hard-coded text in components.
 * Sample department data lives separately in src/data/mock/departments.ts.
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
}
