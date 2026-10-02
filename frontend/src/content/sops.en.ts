/*
 * English content for the SOPs list page.
 * Same pattern as the other content files — no hard-coded text in components.
 * Sample SOP data lives separately in src/data/mock/sops.ts.
 */

import type { SopsContent } from './types'

export const sopsEn: SopsContent = {
  pageTitle: 'SOPs | Hawkim',
  title: 'Standard Operating Procedures',
  subtitle: 'Access and view approved SOPs.',
  tabsLabel: 'Filter SOPs',
  tabs: {
    all: 'All',
    myDepartment: 'My Department',
    recent: 'Recently Added',
  },
  viewToggle: {
    label: 'View',
    grid: 'Grid view',
    list: 'List view',
  },
  columns: {
    code: 'Code',
    title: 'Title',
    department: 'Department',
    version: 'Version',
    lastUpdated: 'Last updated',
    access: 'Access',
  },
  access: {
    restricted: 'Restricted',
    requestAccess: 'Request access',
    accessRequested: 'Access requested',
  },
  versionTemplate: 'Version {version}',
  empty: 'No SOPs to show here yet.',
}
