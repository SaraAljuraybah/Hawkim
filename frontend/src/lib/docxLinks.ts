/*
 * Links in a Word preview. docx-preview copies a document's link targets as they are, so a file can
 * carry "javascript:" or other unsafe links. After rendering, only web (http, https), email (mailto)
 * and in-document (#…) links stay; any other link becomes plain text.
 */

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** Whether a link target may stay: an absolute http(s) or mailto link, or an anchor in the document. */
export function isSafeDocxHref(href: string | null): boolean {
  const value = (href ?? '').trim()
  if (value.startsWith('#')) return value.length > 1
  try {
    // Without a base, relative links throw (they would point into Hawkim itself).
    return SAFE_PROTOCOLS.has(new URL(value).protocol)
  } catch {
    return false
  }
}

/** The parts of the DOM this needs (so it can be tested without a browser). */
interface LinkLike {
  getAttribute(name: string): string | null
  readonly childNodes: ArrayLike<unknown>
  replaceWith(...nodes: never[]): void
}

/** Replaces every unsafe link inside `root` with its own content (the text stays); returns how many. */
export function sanitizeDocxLinks(root: { querySelectorAll(selector: 'a'): ArrayLike<LinkLike> }): number {
  let removed = 0
  for (const link of Array.from(root.querySelectorAll('a'))) {
    if (isSafeDocxHref(link.getAttribute('href'))) continue
    link.replaceWith(...(Array.from(link.childNodes) as never[]))
    removed += 1
  }
  return removed
}
