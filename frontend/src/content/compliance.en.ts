/*
 * English content for compliance checks: the card on the SOP workflow page
 * and the compliance report page.
 * Same pattern as the other content files — no hard-coded text in components.
 */

import type { ComplianceContent } from './types'

export const complianceEn: ComplianceContent = {
  results: {
    compliant: 'Compliant',
    partial: 'Partially compliant',
    conflict: 'Conflict',
    'not-addressed': 'Not addressed',
  },
  sampleBanner: 'Sample results — the compliance service isn’t connected yet.',
  summary: '{count} of {total} requirements compliant',
  countsLabel: 'Results by label',
  guideline: '{name} v{version}',
  details: {
    checked: 'Checked',
    version: 'Version checked',
    guideline: 'Guideline',
  },
  card: {
    title: 'Compliance check',
    running: 'Checking against SFDA GVP v{version}…',
    completed: 'Compliance check completed.',
    failed: 'The compliance check couldn’t be completed.',
    none: 'No compliance check for version {version} yet.',
    viewReport: 'View full report',
    runAgain: 'Run check again',
    run: 'Run check',
  },
  report: {
    pageTitle: 'Compliance report · {code} | Hawkim',
    back: 'Back to {code}',
    title: 'Compliance report',
    versionSelect: { label: 'Report for', option: 'Version {version}', current: 'Version {version} (current)' },
    summaryTitle: 'Summary',
    findingsTitle: 'Findings',
    tabsLabel: 'Filter findings by result',
    tabs: {
      all: 'All',
      conflict: 'Conflict',
      'not-addressed': 'Not addressed',
      partial: 'Partially compliant',
      compliant: 'Compliant',
    },
    requirementReference: 'GVP {module} · {section} {title} · p. {page}',
    justification: 'Justification',
    sopReference: 'SOP reference: {reference}',
    empty: 'No findings with this result.',
    outOfDate: 'A new compliance check is running for version {version}. This report may be out of date.',
    running: 'The compliance check for version {version} is still running.',
    failed: 'The compliance check for version {version} couldn’t be completed.',
    none: 'There’s no compliance report for version {version} yet.',
  },
}
