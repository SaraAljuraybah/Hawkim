/*
 * English content for compliance checks: the card on the SOP workflow page
 * and the compliance report page.
 * Same pattern as the other content files — no hard-coded text in components.
 */

import type { ComplianceContent } from './types'

export const complianceEn: ComplianceContent = {
  results: {
    compliant: 'Compliant',
    partial: 'Partially Compliant',
    conflict: 'Conflict',
    'not-addressed': 'Requires Human Review',
  },
  sampleBanner: 'Sample results — the compliance service isn’t connected yet.',
  summary: '{count} of {total} requirements compliant',
  countsLabel: 'Results by label',
  versionLabel: 'v{version}',
  guideline: '{name} v{version}',
  details: {
    checked: 'Check Date',
    version: 'Version Checked',
    guideline: 'Guideline',
  },
  card: {
    title: 'Compliance Overview',
    running: 'Checking against SFDA GVP v{version}…',
    completed: 'Compliance check completed.',
    failed: 'The compliance check couldn’t be completed.',
    notChecked: 'v{version} hasn’t been checked yet. Run a compliance check to see the results.',
    viewReport: 'View Full Report',
    recheck: {
      badge: 'Recheck Recommended',
      note: 'Last checked against GVP v{checked}. The current version is v{current}.',
    },
  },
  report: {
    pageTitle: 'Compliance Report · {title} | Hawkim',
    printTitle: 'Compliance Report {title} v{version}',
    back: 'Back to {title}',
    title: 'Compliance Report',
    download: 'Download PDF',
    versionSelect: { label: 'Report for', option: 'v{version}', current: 'v{version} (Current)' },
    header: {
      title: 'Report Details',
      sop: 'SOP',
      version: 'Version Checked',
      author: 'Author',
      coAuthors: 'Co-authors',
      department: 'Department',
      checked: 'Check Date',
      guideline: 'Guideline',
      checkedBy: 'Checked By',
      checker: 'Hawkim compliance checker',
      runBy: 'Run By',
    },
    summary: {
      title: 'Summary',
      score: '{score}%',
      scoreNote: 'The Compliance Score shows the percentage of SOP procedures that fully comply with the GVP requirements.',
      ringLabel: 'Compliance score {score} percent, {count} of {total} requirements compliant',
      ringCaption: 'compliant',
      verdicts: {
        'fully-compliant': 'Fully Compliant',
        'needs-improvement': 'Needs Improvement',
        'action-required': 'Action Required',
      },
      tilesLabel: 'Results by label',
      goToFindings: 'Go to {category} findings',
    },
    overview: {
      title: 'Requirements Overview',
      findingId: 'Finding ID',
      requirement: 'Requirement',
      result: 'Result',
      requirementLabel: '{id} · {section} {title}',
    },
    findings: {
      title: 'Findings',
      tabsLabel: 'Filter findings by result',
      tabs: {
        all: 'All',
        conflict: 'Conflict',
        'not-addressed': 'Requires Human Review',
        partial: 'Partially Compliant',
        compliant: 'Compliant',
      },
      needsAttention: 'Needs Attention',
      compliant: 'Compliant',
      heading: '{number} · Requirement {requirement}',
      requirementReference: 'GVP {module} · {section} {title} · p. {page}',
      sopReference: 'SOP Reference',
      noSopReference: 'None — the SOP doesn’t cover this requirement.',
      justification: 'Justification',
      recommendedAction: 'Recommended Action',
      empty: 'No findings with this result.',
    },
    outOfDate: 'A new compliance check is running for v{version}. This report may be out of date.',
    olderGuideline: 'This report used GVP v{checked}. The current version is v{current}.',
    running: 'The compliance check for v{version} is still running.',
    failed: 'The compliance check for v{version} couldn’t be completed.',
    none: 'There’s no compliance report for v{version} yet.',
  },
}
