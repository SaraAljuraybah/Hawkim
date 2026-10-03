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
    printTitle: 'Compliance report {code} v{version}',
    back: 'Back to {code}',
    title: 'Compliance report',
    download: 'Download PDF',
    versionSelect: { label: 'Report for', option: 'Version {version}', current: 'Version {version} (current)' },
    header: {
      title: 'Report details',
      reportId: 'Report ID',
      sop: 'SOP',
      version: 'Version checked',
      author: 'Author',
      coAuthors: 'Co-authors',
      department: 'Department',
      checked: 'Checked',
      guideline: 'Guideline',
      checkedBy: 'Checked by',
      checker: 'Hawkim compliance checker',
    },
    summary: {
      title: 'Executive summary',
      score: '{score}%',
      scoreNote: 'Compliance score: compliant requirements out of all checked requirements. Partially compliant, not addressed and conflict findings don’t count toward the score.',
      ringLabel: 'Compliance score {score} percent, {count} of {total} requirements compliant',
      ringCaption: 'compliant',
      verdicts: {
        'fully-compliant': 'Fully compliant',
        'needs-improvement': 'Needs improvement',
        'action-required': 'Action required',
      },
      explanation: {
        actionRequired: {
          one: 'Action required: the SOP conflicts with {count} requirement.',
          other: 'Action required: the SOP conflicts with {count} requirements.',
        },
        needsImprovement: {
          one: 'Needs improvement: {count} requirement is partially compliant or not addressed.',
          other: 'Needs improvement: {count} requirements are partially compliant or not addressed.',
        },
      },
      tilesLabel: 'Results by label',
      priorities: {
        title: 'Top priorities',
        item: '{number} · {result} · {requirement} · {title}',
      },
      change: {
        title: 'Change since the previous version',
        score: 'Score: {before} → {after} ({delta})',
        verdict: 'Verdict: {before} → {after} ({kind})',
        percent: '{score}%',
        delta: {
          up: '+{points} points since v{version}',
          down: '−{points} points since v{version}',
          same: 'no change since v{version}',
        },
        kinds: { improved: 'improved', worsened: 'worsened', unchanged: 'unchanged' },
        changedTo: 'changed to',
      },
      attention: {
        conflict: { one: '{count} conflict', other: '{count} conflicts' },
        'not-addressed': { one: '{count} requirement not addressed', other: '{count} requirements not addressed' },
        partial: { one: '{count} partially compliant requirement', other: '{count} partially compliant requirements' },
      },
      and: 'and',
      beforeSubmit: {
        one: '{items} needs attention before submitting for review.',
        other: '{items} need attention before submitting for review.',
      },
      needsAttention: { one: '{items} needs attention.', other: '{items} need attention.' },
      allCompliant: 'All checked requirements are compliant.',
    },
    overview: {
      title: 'Requirements overview',
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
        'not-addressed': 'Not addressed',
        partial: 'Partially compliant',
        compliant: 'Compliant',
      },
      needsAttention: 'Needs attention',
      compliant: 'Compliant',
      heading: '{number} · Requirement {requirement}',
      requirementReference: 'GVP {module} · {section} {title} · p. {page}',
      sopReference: 'SOP reference',
      noSopReference: 'None — the SOP doesn’t cover this requirement.',
      justification: 'Justification',
      recommendedAction: 'Recommended action',
      empty: 'No findings with this result.',
    },
    changes: {
      title: 'Changes since the previous version',
      comparedWith: 'Compared with the report for version {version} ({reportId}).',
      none: 'No previous report.',
      changedTo: 'changed to',
      kinds: {
        resolved: 'resolved',
        improved: 'improved',
        unchanged: 'unchanged',
        worsened: 'worsened',
        new: 'new',
        removed: 'no longer checked',
      },
    },
    method: {
      title: 'Method and limitations',
      items: [
        'Hawkim retrieves the GVP requirements most relevant to the SOP and assesses each one with a locally hosted language model.',
        'This report supports human review. Final review, approval and publication remain the responsibility of the assigned reviewers and approvers.',
        'These are sample results; the compliance service isn’t connected yet.',
      ],
    },
    outOfDate: 'A new compliance check is running for version {version}. This report may be out of date.',
    running: 'The compliance check for version {version} is still running.',
    failed: 'The compliance check for version {version} couldn’t be completed.',
    none: 'There’s no compliance report for version {version} yet.',
  },
}
