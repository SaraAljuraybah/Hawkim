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
subtitle: 'Published SOPs you authored, co-authored, reviewed or approved.',
adminSubtitle: 'Browse every published SOP in your organization.',

  tabsLabel: 'Filter SOPs',
  tabs: {
    all: 'All',
    recent: 'Recently Published',
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
  versionTemplate: 'v{version}',
  empty: "You haven't worked on any published SOPs yet.",
  adminEmpty: 'No published SOPs yet.',
  recentEmpty: 'No SOPs published in the last 3 months.',

  detail: {
    fileFailed: "The file couldn't be opened. Try again.",
    subtitle: '{division} · {department} · Published on {date}',
    subtitleNoDivision: '{department} · Published on {date}',
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
      text: 'You can open the published SOPs you authored, co-authored, reviewed or approved.',
      adminText: 'This SOP belongs to {department}.',
    },
  },
}
