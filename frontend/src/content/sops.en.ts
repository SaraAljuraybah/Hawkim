/*
 * English content for the SOPs list page.
 * Same pattern as the other content files — no hard-coded text in components.
 * Sample SOP data lives separately in src/data/mock/sops.ts.
 */

import type { SopsContent } from './types'

export const sopsEn: SopsContent = {
  
pageTitle: 'SOP Directory | Hawkim',
adminPageTitle: 'SOP Directory · Admin Portal | Hawkim',
title: 'SOP Directory',
subtitle: 'Browse published SOPs available to you.',

  tabsLabel: 'Filter SOPs',
  tabs: {
    all: 'All',
    recent: 'Recently Published',
    others: 'Others',
  },
  filters: {
    label: 'Search and filter SOPs',
    searchLabel: 'Search SOPs',
    searchPlaceholder: 'Search by SOP title',
    sortLabel: 'Sort By',
    sortNewest: 'Newest to Oldest',
    sortOldest: 'Oldest to Newest',
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
  othersSection: 'Others: SOPs of departments that no longer exist',
  othersEmpty: 'No SOPs in Others.',
  versionTemplate: 'v{version}',
  empty: 'No SOPs in this department yet.',
  adminEmpty: 'No published SOPs yet.',
  recentEmpty: 'No SOPs published in the last 3 months.',

  detail: {
    fileFailed: "The file couldn't be opened. Try again.",
    subtitle: 'Published on {date} · {department} · SOP v{version}',
    pageTitle: '{title} | Hawkim',
    adminPageTitle: '{title} · Admin Portal | Hawkim',
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
      download: 'Download Document',
      viewerTitle: '{title} (Word document preview)',
    },
    noFile: "The file for this SOP isn't available yet.",
    noAccess: {
      title: "You don't have access to this SOP",
      text: 'This SOP belongs to {department}. Request access to that department to view it.',
      adminText: 'This SOP belongs to {department}.',
      requestAccess: 'Request Access',
    },
    pendingAccess: {
      title: 'Your access request is pending review',
      text: "You'll be able to open this SOP once an administrator approves your access to {department}.",
    },
  },
}
