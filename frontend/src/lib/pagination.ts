/*
 * Client-side pagination of lists already loaded in the browser (My SOPs, the SOP Directory),
 * and the list state kept in the URL: default values add nothing, invalid values mean the default.
 */

export const PAGE_SIZE = 12

/** How many pages a list has: at least one, even when empty. */
export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size))
}

/** The page number in the URL: a whole number from 1, otherwise page 1. */
export function parsePage(value: string | null): number {
  return value && /^[1-9]\d*$/.test(value) ? Number(value) : 1
}

/** A page that's too high (for example after a delete) shows the last page. */
export function clampPage(page: number, count: number): number {
  return Math.min(Math.max(1, page), Math.max(1, count))
}

/** The items on a page. */
export function pageSlice<T>(items: T[], page: number, size = PAGE_SIZE): T[] {
  return items.slice((page - 1) * size, page * size)
}

export type PageItem = number | 'gap-start' | 'gap-end'

/**
 * The page numbers to show: the first and the last page, and the current page with `siblings` on
 * each side, with a gap ("…") in between. A gap of a single page shows that page instead.
 * For example, page 5 of 20: 1 … 4 5 6 … 20.
 */
export function pageItems(current: number, count: number, siblings = 1): PageItem[] {
  const pages = new Set<number>([1, count])
  for (let page = current - siblings; page <= current + siblings; page += 1) {
    if (page >= 1 && page <= count) pages.add(page)
  }
  const sorted = [...pages].sort((a, b) => a - b)
  const items: PageItem[] = []
  sorted.forEach((page, index) => {
    const previous = sorted[index - 1]
    if (previous !== undefined && page - previous === 2) items.push(previous + 1)
    else if (previous !== undefined && page - previous > 2) items.push(page <= current ? 'gap-start' : 'gap-end')
    items.push(page)
  })
  return items
}

/**
 * Switching tabs: remember the page of the tab being left, and open the next tab on the page it
 * was left on (page 1 if it wasn't opened yet). Each list clamps it to its own last page.
 */
export function switchTabPage<T extends string>(pages: Partial<Record<T, number>>, from: T, fromPage: number, to: T) {
  return { pages: { ...pages, [from]: fromPage } as Partial<Record<T, number>>, page: pages[to] ?? 1 }
}

/** New results (search, sort or a filter changed): the URL goes back to page 1. */
export function resultsParams(
  current: URLSearchParams, changes: Record<string, string | undefined>, defaults: Record<string, string>,
): URLSearchParams {
  return updateParams(current, { ...changes, page: undefined }, defaults)
}

/** Switching tabs: the next tab and the page it was left on in the URL, and the pages remembered. */
export function tabSwitch<T extends string>(
  current: URLSearchParams, pages: Partial<Record<T, number>>, from: T, fromPage: number, to: T, defaults: Record<string, string>,
) {
  const switched = switchTabPage(pages, from, fromPage, to)
  return { params: updateParams(current, { tab: to, page: switched.page }, defaults), pages: switched.pages }
}

/** After removing one item from a list of `remaining` + 1: the page to show (the previous page when this one is now empty). */
export function pageAfterRemoval(page: number, remaining: number): number {
  return clampPage(page, pageCount(remaining))
}

/** The pages remembered for the other tabs belong to one department; another department starts every tab on page 1. */
export interface RememberedPages<T extends string> {
  department: string
  pages: Partial<Record<T, number>>
}

export function rememberedPagesFor<T extends string>(memory: RememberedPages<T>, department: string): Partial<Record<T, number>> {
  return memory.department === department ? memory.pages : {}
}

/** One value from the URL: one of the allowed values, otherwise the default. */
export function readChoice<T extends string>(params: URLSearchParams, name: string, allowed: readonly T[], fallback: T): T {
  const value = params.get(name)
  return allowed.includes(value as T) ? (value as T) : fallback
}

/**
 * Changes the given URL parameters. A value equal to its default (or empty) is removed,
 * so the default list has a plain URL. Other parameters stay.
 */
export function updateParams(
  current: URLSearchParams, changes: Record<string, string | number | undefined>, defaults: Record<string, string>,
): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const [name, value] of Object.entries(changes)) {
    const text = value === undefined ? '' : String(value)
    if (!text || text === defaults[name]) next.delete(name)
    else next.set(name, text)
  }
  return next
}

/** The same URL query without its page (for example after switching department), or '' when nothing is left. */
export function searchWithoutPage(search: string): string {
  const params = new URLSearchParams(search)
  params.delete('page')
  const text = params.toString()
  return text ? `?${text}` : ''
}
