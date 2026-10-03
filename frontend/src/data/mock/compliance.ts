import type { Finding, Guideline, Requirement } from './types'

/*
 * Sample compliance data. The compliance service (BGE-M3 + Llama 3.1 8B against
 * the SFDA GVP) doesn't exist yet, so every check returns the same sample results.
 * TODO: Replace with requirements and results from the compliance service API.
 */

/** The guideline SOPs are checked against. */
export const GVP_GUIDELINE: Guideline = {
  name: 'SFDA Guideline on Good Pharmacovigilance Practices (GVP)',
  version: '4.0',
}

/** Requirements from GVP v4.0 (section numbers and pages as in the document; summaries paraphrased). */
export const requirements: Requirement[] = [
  {
    id: 'R1',
    module: 'Module I',
    section: 'I.B.10',
    sectionTitle: 'Record management',
    page: 22,
    summary: 'Access to pharmacovigilance documents and databases is strictly limited to authorized personnel.',
  },
  {
    id: 'R2',
    module: 'Module I',
    section: 'I.B.10',
    sectionTitle: 'Record management',
    page: 22,
    summary: 'Pharmacovigilance data and records are protected from destruction during the applicable retention period.',
  },
  {
    id: 'R3',
    module: 'Module I',
    section: 'I.B.10',
    sectionTitle: 'Record management',
    page: 22,
    summary: 'The record management system supports timely access to all records.',
  },
  {
    id: 'R4',
    module: 'Module I',
    section: 'I.C.1.4',
    sectionTitle: 'Specific quality system processes of the MAH in KSA',
    page: 34,
    summary:
      'Documents may be retained electronically only if the system is validated, with appropriate arrangements for system security, access and back-up of data.',
  },
  {
    id: 'R5',
    module: 'Module I',
    section: 'I.B.7',
    sectionTitle: 'Training of personnel for pharmacovigilance',
    page: 19,
    summary: 'Personnel receive initial and continued training, and training records are kept.',
  },
]

/** A requirement by id (undefined if unknown). */
export function getRequirement(id: string): Requirement | undefined {
  return requirements.find((requirement) => requirement.id === id)
}

/**
 * The sample result set every check returns (same for every SOP).
 * The sample SOP data (sops.ts) repeats these findings for its saved reports
 * (SOP-078's earlier versions have different sample results).
 */
export const SAMPLE_FINDINGS: Omit<Finding, 'id'>[] = [
  {
    requirementId: 'R1',
    result: 'compliant',
    justification: 'Sample finding: the SOP describes role-based access approval for the system.',
    sopReference: 'Section 4.2',
  },
  {
    requirementId: 'R2',
    result: 'partial',
    justification:
      'Sample finding: the SOP describes regular back-ups of records but does not say how long pharmacovigilance records are kept.',
    sopReference: 'Section 5.1',
    recommendedAction:
      'Sample recommendation: state how long pharmacovigilance records are kept and how they are protected during that period.',
  },
  {
    requirementId: 'R3',
    result: 'compliant',
    justification: 'Sample finding: the SOP explains how records are indexed so they can be found and retrieved on request.',
    sopReference: 'Section 5.3',
  },
  {
    requirementId: 'R4',
    result: 'conflict',
    justification: 'Sample finding: the SOP stores archived records on a system with no scheduled back-up, which conflicts with the back-up requirement.',
    sopReference: 'Section 6.2',
    recommendedAction:
      'Sample recommendation: define a scheduled, tested back-up for the archive system.',
  },
  {
    requirementId: 'R5',
    result: 'not-addressed',
    justification: 'Sample finding: the SOP does not mention training for staff who perform this procedure.',
    recommendedAction:
      'Sample recommendation: describe the initial and continued training for staff who perform this procedure, and where training records are kept.',
  },
]
