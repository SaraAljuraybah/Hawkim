/*
 * English content for compliance checks: the card on the SOP workflow page.
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
}
