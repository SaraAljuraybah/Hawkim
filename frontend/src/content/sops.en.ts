/*
 * English content for the SOPs list page.
 * Same pattern as the other content files — no hard-coded text in components.
 * Sample SOP data lives separately in src/data/mock/sops.ts.
 */

import type { SopsContent } from './types'

export const sopsEn: SopsContent = {
  
pageTitle: 'SOP Directory | Hawkim',
title: 'SOP Directory',
subtitle: 'Browse published SOPs available to you.',

  tabsLabel: 'Filter SOPs',
  tabs: {
    all: 'All',
    recent: 'Recently Added',
  },
  filters: {
    label: 'Search and filter SOPs',
    searchLabel: 'Search SOPs',
    searchPlaceholder: 'Search by SOP title',
    typeLabel: 'Document Type',
    types: { all: 'All Document Types', pdf: 'PDF', docx: 'Word' },
    clear: 'Clear Filters',
    empty: 'No SOPs match your search and filters. Try another search or clear the filters.',
    oneResult: '1 SOP found',
    results: '{count} SOPs found',
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
    lastUpdated: 'Last Updated',
  },
  departmentLabel: 'Department',
  versionTemplate: 'v{version}',
  empty: 'No SOPs in this department yet.',

  detail: {
    fileFailed: 'This file is not available in the local prototype.',
    pageTitle: '{title} | Hawkim',
   back: { label: 'Back to SOP Directory', href: '/sops' },
    exportPdf: 'Export PDF',
    descriptionTitle: 'SOP Description',
    viewerTitle: '{title} (PDF)',
    fallback: {
      text: "Your browser can't display the PDF here. Open it in a new tab or export it instead.",
      openPdf: 'Open PDF',
      newTabHint: '(opens in a new tab)',
    },
    docx: {
      text: "Preview isn't available for Word documents yet.",
      download: 'Download Document',
    },
    noFile: "The file for this SOP isn't available yet.",
    noAccess: {
      title: "You don't have access to this SOP",
      text: 'This SOP belongs to {department}. Request access to that department to view it.',
      requestAccess: 'Request Access',
    },
    pendingAccess: {
      title: 'Your access request is pending review',
      text: "You'll be able to open this SOP once the admin team approves your access to {department}.",
    },
  },
}
