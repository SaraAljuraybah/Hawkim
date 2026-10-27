/** Author-controlled approval submission, separate from internal review requests. */
export const approvalEn = {
  action: 'Submit for Approval',
  submitted: 'Submitted for approval.',
  dialog: {
    title: 'Submit for Approval',
    description: 'Send this version to the configured Quality Document Controller after all required reviews are complete.',
    controller: 'Assigned Approver',
    noExternalReviews: 'I confirm that no external department reviews are required for this SOP version.',
    noExternalReviewsHint: 'This confirmation is recorded in the SOP timeline. If external reviews are required, complete external routing before submitting for approval.',
    feedbackAddressed: 'I confirm that all required reviewer feedback has been addressed for this SOP version.',
    dueDate: 'Approval Due Date (Optional)',
    dueDateHelp: 'Applies to the assigned Approver. Leave blank for no deadline.',
    dateInvalid: 'Choose a date from {min} to {max}, or leave it blank.',
    failed: 'The SOP could not be submitted for approval. Check the current workflow state and try again.',
    cancel: 'Cancel',
  },
  /**
   * Why Submit for approval isn't available yet, in the tooltip on the author's page (by code from
   * lib/approval). Codes only checked in the dialog keep the dialog's full sentence.
   */
  blockers: {
    'not-main-author': 'Only the main author can submit for approval.',
    'department-unavailable': 'This SOP’s department is no longer available. Ask your admin.',
    'not-in-review': 'Submit this version for review first.',
    'reviews-incomplete': 'Waiting for all reviewers to finish reviewing the current version.',
    'already-requested': 'Already sent for approval.',
    'compliance-check': 'Run the compliance check for the current version first.',
    'external-incomplete': 'Wait for the required reviews from other departments to finish.',
    'external-no-reviewer': 'A required review from another department has no reviewer. Ask your admin.',
    'no-approver': 'No approver is assigned.',
  },
  /** `already-requested` while the approver's return is on the current version. */
  returnedByApprover: 'The approver returned this SOP. Upload a new version first.',
  events: {
    'external-reviews-not-required': 'External reviews confirmed not required',
    'submitted-for-approval': 'Submitted for approval by Author',
  },
}
