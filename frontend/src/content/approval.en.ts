/** Author-controlled approval submission, separate from internal review requests. */
export const approvalEn = {
  action: 'Submit for Approval',
  submitted: 'Submitted for approval.',
  dialog: {
    title: 'Submit for Approval',
    description: 'Send this version to the department’s Quality Document Controller for approval.',
    controller: 'Assigned Approver',
    dueDate: 'Approval Due Date (Optional)',
    dueDateHelp: 'Applies to the assigned Approver. Leave blank for no deadline.',
    dateInvalid: 'Choose a date from {min} to {max}, or leave it blank.',
    failed: 'The SOP could not be submitted for approval. Check the current workflow state and try again.',
    cancel: 'Cancel',
  },
  /**
   * Why Submit for approval isn't available (by code from lib/approval): the first two in the
   * tooltip on the author's page, the others as errors in the dialog.
   */
  blockers: {
    'already-requested': 'Already sent for approval.',
    'no-completed-review': 'At least one reviewer must complete the review of the current version first.',
    'not-main-author': 'Only the main author can submit for approval.',
    'version-changed': 'This SOP changed after you opened this dialog. Close it and try again.',
    'no-approver': 'No approver is available. Contact your admin.',
  },
  events: {
    'external-reviews-not-required': 'External reviews confirmed not required',
    'submitted-for-approval': 'Submitted for approval by Author',
  },
}
