/**
 * Shared title validation for Add SOP, Edit SOP Details and the draft mutation. 150 is the database's own limit
 * (sops.title: trimmed, 1 to 150 characters; create_sop and update_sop_details check the same).
 */
export const SOP_TITLE_MAX = 150

export function sopTitleProblem(value: string): 'required' | 'too-long' | undefined {
  if (!value.trim()) return 'required'
  return value.length > SOP_TITLE_MAX ? 'too-long' : undefined
}
