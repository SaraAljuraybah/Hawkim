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
    'not-addressed': 'Not Addressed',
  },
  sampleBanner: 'Sample results — the compliance service isn’t connected yet.',
  summary: '{count} of {total} requirements compliant',
  countsLabel: 'Results by label',
  versionLabel: 'v{version}',
  guideline: '{name} v{version}',
  details: {
    checked: 'Checked',
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
      checked: 'Checked',
      guideline: 'Guideline',
      checkedBy: 'Checked By',
      checker: 'Hawkim compliance checker',
      runBy: 'Run By',
    },
    summary: {
      title: 'Executive Summary',
      score: '{score}%',
      scoreNote: 'Compliance score: compliant requirements out of all checked requirements. Partially compliant, not addressed and conflict findings don’t count toward the score.',
      ringLabel: 'Compliance score {score} percent, {count} of {total} requirements compliant',
      ringCaption: 'compliant',
      verdicts: {
        'fully-compliant': 'Fully Compliant',
        'needs-improvement': 'Needs Improvement',
        'action-required': 'Action Required',
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
        title: 'Top Priorities',
        item: '{number} · {result} · {requirement} · {title}',
      },
      change: {
        title: 'Change Since the Previous Version',
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
        'not-addressed': 'Not Addressed',
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
    changes: {
      title: 'Changes Since the Previous Version',
      comparedWith: 'Compared with the report for v{version}.',
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
      title: 'Method and Limitations',
      items: [
        'Hawkim retrieves the GVP requirements most relevant to the SOP and assesses each one with a locally hosted language model.',
        'This report supports human review. Final review, approval and publication remain the responsibility of the assigned reviewers and approvers.',
        'These are sample results; the compliance service isn’t connected yet.',
      ],
    },
    outOfDate: 'A new compliance check is running for v{version}. This report may be out of date.',
    olderGuideline: 'This report used GVP v{checked}. The current version is v{current}.',
    running: 'The compliance check for v{version} is still running.',
    failed: 'The compliance check for v{version} couldn’t be completed.',
    none: 'There’s no compliance report for v{version} yet.',
  },
}
