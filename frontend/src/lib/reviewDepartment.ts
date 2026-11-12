/** How Submit for Review is opened: 'add' sends the current version to more reviewers; 'version' sends a new version. */
export type SubmitMode = 'submit' | 'add' | 'version'

/** Why the dialog's Division and Department stay on the SOP's own. */
export type ReviewDepartmentLock = 'first-review' | 'first-send' | 'home-must-finish'

/**
 * Why the dialog's Division and Department stay on the SOP's own: the SOP's first review (a Draft),
 * or the first send of a new version, both through submit_for_review, which accepts reviewers from
 * the SOP's department only (all_home_reviewers); or adding reviewers before a reviewer from the SOP's
 * department has finished the current version (completed or returned it), as add_reviewers refuses
 * other departments until has_home_finished.
 */
export function reviewDepartmentLock(mode: SubmitMode, homeFinished: boolean): ReviewDepartmentLock | undefined {
  if (mode === 'submit') return 'first-review'
  if (mode === 'version') return 'first-send'
  return homeFinished ? undefined : 'home-must-finish'
}

/** Whether a Division or Department choice is refused: a different one while locked ('' while typing is no choice). */
export function refusesChoice(locked: boolean, own: string, next: string): boolean {
  return locked && !!next && next !== own
}

/**
 * A locked Division or Department looks like the read-only Department on Add SOP, but stays an
 * openable combobox. An error keeps its own border.
 */
export function lockedFieldClass(locked: boolean, error: boolean): string | undefined {
  if (!locked) return undefined
  return error ? '[&_input]:bg-beige/50' : '[&_input]:border-beige [&_input]:bg-beige/50'
}
