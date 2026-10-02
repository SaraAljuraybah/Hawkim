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

  detail: {
    pageTitle: '{code} | Hawkim',
    back: { label: 'Back to SOPs', href: '/sops' },
    exportPdf: 'Export PDF',
    viewerTitle: '{code} {title} (PDF)',
    fallback: {
      text: "Your browser can't display the PDF here. Open it in a new tab or export it instead.",
      openPdf: 'Open PDF',
      newTabHint: '(opens in a new tab)',
    },
    docx: {
      text: "Preview isn't available for Word documents yet.",
      download: 'Download document',
    },
    noAccess: {
      title: "You don't have access to this SOP",
      text: 'This SOP belongs to {department}. Request access to that department to view it.',
    },
    pendingAccess: {
      title: 'Your access request is pending review',
      text: "You'll be able to open this SOP once the admin team approves your access to {department}.",
    },
  },
}
