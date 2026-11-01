/*
 * English content for My Profile.
 * Same pattern as the other content files — no hard-coded text in components.
 */

import type { ProfileContent } from './types'

export const profileEn: ProfileContent = {
  pageTitle: 'My Profile | Hawkim',
  title: 'My Profile',
  detailsTitle: 'Your Information',
  fields: { name: 'Name', email: 'Email', department: 'Department', division: 'Division', roles: 'Roles' },
  none: '—',
  roles: { author: 'Author', reviewer: 'Reviewer', approver: 'Approver' },
}
