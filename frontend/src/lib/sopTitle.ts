/** Shared creation validation for the upload form and the draft mutation. */
export const SOP_TITLE_MAX = 50

export function sopTitleProblem(value: string): 'required' | 'too-long' | undefined {
  if (!value.trim()) return 'required'
  return value.length > SOP_TITLE_MAX ? 'too-long' : undefined
}
