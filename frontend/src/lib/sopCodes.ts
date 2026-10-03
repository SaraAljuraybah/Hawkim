/** Number part of an SOP code ("SOP-083" → 83), or NaN if it doesn't match. */
function codeNumber(code: string): number {
  const match = /^SOP-(\d+)$/.exec(code)
  return match ? Number(match[1]) : Number.NaN
}

/**
 * Code for a new SOP: one higher than the author's highest code, skipping any
 * code already used anywhere (so codes are never duplicated).
 * e.g. author's highest SOP-082, directory has SOP-093 → "SOP-083".
 *
 * TODO: The backend should assign codes, so two people can't get the same one.
 */
export function nextSopCode(authorCodes: string[], allCodes: string[]): string {
  const used = new Set(allCodes.map(codeNumber).filter((n) => !Number.isNaN(n)))
  const authorNumbers = authorCodes.map(codeNumber).filter((n) => !Number.isNaN(n))
  let next = (authorNumbers.length > 0 ? Math.max(...authorNumbers) : 0) + 1
  while (used.has(next)) next += 1
  return `SOP-${String(next).padStart(3, '0')}`
}
