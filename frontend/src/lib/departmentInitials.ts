/*
 * Department initials (PBI 13). Admins no longer type them: the badge beside a department's name
 * shows an abbreviation derived from the name, and the stored `departments.initials` value that the
 * database still requires is generated here too.
 */

/** Connector words that never give a letter, e.g. "Department of Health" → DH. */
const CONNECTORS = new Set(['and', 'of', 'the', 'for', 'in', 'on', 'at', 'to', 'with', 'or', 'a', 'an'])

/** The meaningful words of a name: punctuation and symbols such as "&" are separators, connectors are skipped. */
function meaningfulWords(name: string, wordPattern: RegExp): string[] {
  const words = name.split(wordPattern).filter(Boolean)
  const meaningful = words.filter((word) => !CONNECTORS.has(word.toLowerCase()))
  // A name made only of connectors still gets an abbreviation.
  return meaningful.length ? meaningful : words
}

function abbreviate(words: string[]): string {
  const [first, second] = words
  if (!first) return ''
  // One word: its first two letters (Finance → FI); a one-letter word stays one letter.
  const letters = second ? [Array.from(first)[0], Array.from(second)[0]] : Array.from(first).slice(0, 2)
  return letters.join('').toUpperCase()
}

/**
 * The badge abbreviation: the first letter of each of the first two meaningful words, uppercase
 * ("Research & Development" → RD, "Human Resources Management" → HR). It follows the name, so it
 * changes when the department is renamed. Two departments may share one; the name is always shown beside it.
 */
export function departmentAbbreviation(name: string): string {
  return abbreviate(meaningfulWords(name.trim(), /[^\p{L}\p{N}]+/u))
}

/** What save_department accepts: 2–3 Latin letters (stored uppercase), unique among active departments. */
const STORED_PATTERN = /^[A-Z]{2,3}$/
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Every value tried, best first: the abbreviation, then 3-letter variants of it, then any 2–3 letters. */
function* storedCandidates(name: string): Generator<string> {
  // Latin letters only (accents dropped), as the database requires.
  const latin = name.normalize('NFKD').replace(/[̀-ͯ]/g, '')
  const words = meaningfulWords(latin, /[^A-Za-z]+/)
  const base = abbreviate(words)
  if (base.length === 2) {
    yield base
    if (words.length >= 3) yield (base + words[2][0]).toUpperCase()
    // Then the following letters of the abbreviated words: Quality Audit → QAU, QAD… (one word: Finance → FIN…).
    const rest = words.length >= 2 ? words[1].slice(1) + words[0].slice(1) + words.slice(2).join('') : words[0].slice(2)
    for (const letter of rest.toUpperCase()) yield base + letter
    for (const letter of ALPHABET) yield base + letter
  }
  for (const a of ALPHABET) for (const b of ALPHABET) yield a + b
  for (const a of ALPHABET) for (const b of ALPHABET) for (const c of ALPHABET) yield a + b + c
}

/**
 * The initials saved with a department (never shown or typed). An edited department whose name
 * didn't change keeps its current initials. Otherwise it is the abbreviation when no other department
 * uses it; if one does, the first free 3-letter variant (e.g. QA taken → QAU), so another department's
 * initials are never reused or overwritten and the database's uniqueness rule always holds.
 */
export function storedDepartmentInitials(
  name: string,
  departments: { id: string; name: string; initials: string }[],
  editing?: { id: string; name: string; initials: string },
): string {
  const taken = new Set(departments.filter((department) => department.id !== editing?.id).map((department) => department.initials.trim().toUpperCase()))
  const current = editing?.initials.trim().toUpperCase()
  if (editing && current && STORED_PATTERN.test(current) && !taken.has(current)
    && editing.name.trim().toLowerCase() === name.trim().toLowerCase()) return current
  for (const candidate of storedCandidates(name)) if (!taken.has(candidate)) return candidate
  // Unreachable in practice (17,000+ values); the server would refuse the save rather than collide.
  return ''
}
