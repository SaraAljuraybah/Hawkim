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
    dueDate: 'Approval Due Date (optional)',
    dueDateHelp: 'Applies to the assigned Approver. Leave blank for no deadline.',
    failed: 'The SOP could not be submitted for approval. Check the current workflow state and try again.',
    cancel: 'Cancel',
  },
  events: {
    'external-reviews-not-required': 'External reviews confirmed not required',
    'submitted-for-approval': 'Submitted for approval by Author',
  },
}
