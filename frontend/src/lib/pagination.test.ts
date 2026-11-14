import { describe, expect, it } from 'vitest'
import {
  clampPage, listParam, PAGE_SIZE, pageAfterRemoval, pageCount, pageItems, pageSlice, parsePage, readChoice, readList, rememberedPagesFor, resultsParams,
  searchWithoutPage, switchTabPage, tabSwitch, updateParams,
} from './pagination'
import { MY_SOPS_URL_DEFAULTS, readMySopsUrl } from './mySops'
import { DIRECTORY_URL_DEFAULTS, readDirectoryUrl } from './sopDirectory'

const url = (search: string) => new URLSearchParams(search)

describe('pages', () => {
  it('shows 12 per page, with at least one page', () => {
    expect(PAGE_SIZE).toBe(12)
    expect([0, 1, 12, 13, 24, 25, 30].map((total) => pageCount(total))).toEqual([1, 1, 1, 2, 2, 3, 3])
    const items = Array.from({ length: 30 }, (_, index) => index + 1)
    expect(pageSlice(items, 1)).toEqual(items.slice(0, 12))
    expect(pageSlice(items, 2)).toEqual(items.slice(12, 24))
    expect(pageSlice(items, 3)).toEqual([25, 26, 27, 28, 29, 30])
  })

  it('reads a whole page number from the URL, otherwise page 1', () => {
    expect(['2', '15'].map(parsePage)).toEqual([2, 15])
    expect([null, '', 'abc', '0', '-1', '2.5', '02', ' 2', '1e2'].map(parsePage)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1])
  })

  it('shows the last page for a page that is too high', () => {
    expect(clampPage(5, 3)).toBe(3)
    expect(clampPage(2, 3)).toBe(2)
    expect(clampPage(0, 3)).toBe(1)
    expect(clampPage(4, 1)).toBe(1)
  })

  it('goes to the previous page when the last SOP of the last page is removed', () => {
    expect(pageAfterRemoval(3, 24)).toBe(2) // 25 SOPs, page 3 had one
    expect(pageAfterRemoval(3, 25)).toBe(3)
    expect(pageAfterRemoval(2, 12)).toBe(1)
    expect(pageAfterRemoval(1, 0)).toBe(1)
  })
})

describe('page numbers', () => {
  it('shows every page when there are few', () => {
    expect(pageItems(1, 1)).toEqual([1])
    expect(pageItems(2, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('shows the first, the last and the pages around the current one, with gaps between', () => {
    expect(pageItems(5, 20)).toEqual([1, 'gap-start', 4, 5, 6, 'gap-end', 20])
    expect(pageItems(1, 20)).toEqual([1, 2, 'gap-end', 20])
    expect(pageItems(20, 20)).toEqual([1, 'gap-start', 19, 20])
    expect(pageItems(10, 20)).toEqual([1, 'gap-start', 9, 10, 11, 'gap-end', 20])
  })

  it('shows a single hidden page instead of a gap', () => {
    expect(pageItems(4, 20)).toEqual([1, 2, 3, 4, 5, 'gap-end', 20])
    expect(pageItems(17, 20)).toEqual([1, 'gap-start', 16, 17, 18, 19, 20])
  })

  it('shows only the current page between the first and the last on phones', () => {
    expect(pageItems(5, 20, 0)).toEqual([1, 'gap-start', 5, 'gap-end', 20])
    expect(pageItems(1, 20, 0)).toEqual([1, 'gap-end', 20])
    expect(pageItems(3, 20, 0)).toEqual([1, 2, 3, 'gap-end', 20])
  })
})

describe('each tab remembers its own page', () => {
  it('In Progress page 3 → Completed page 1 → back to In Progress page 3', () => {
    let state = switchTabPage({}, 'progress', 3, 'completed')
    expect(state.page).toBe(1)
    state = switchTabPage(state.pages, 'completed', 1, 'progress')
    expect(state.page).toBe(3)
    expect(state.pages).toEqual({ progress: 3, completed: 1 })
  })

  it('puts the next tab and its page in the URL, keeping search, sort and filters', () => {
    const first = tabSwitch(url('tab=progress&q=backup&role=main&page=3'), {}, 'progress', 3, 'completed', MY_SOPS_URL_DEFAULTS)
    expect(first.params.toString()).toBe('tab=completed&q=backup&role=main')
    const back = tabSwitch(first.params, first.pages, 'completed', 1, 'progress', MY_SOPS_URL_DEFAULTS)
    expect(back.params.toString()).toBe('tab=progress&q=backup&role=main&page=3')
    // The default tab adds nothing.
    expect(tabSwitch(url('tab=progress'), {}, 'progress', 1, 'new', MY_SOPS_URL_DEFAULTS).params.toString()).toBe('')
  })

  it('goes back to page 1 when the results change (search, sort or a filter)', () => {
    expect(resultsParams(url('tab=progress&page=3'), { q: 'backup' }, MY_SOPS_URL_DEFAULTS).toString()).toBe('tab=progress&q=backup')
    expect(resultsParams(url('tab=others&page=2&type=pdf'), { sort: 'oldest' }, DIRECTORY_URL_DEFAULTS).toString()).toBe('tab=others&type=pdf&sort=oldest')
    // Clear Filters.
    expect(resultsParams(url('q=a&role=main&page=2'), { q: undefined, role: undefined }, MY_SOPS_URL_DEFAULTS).toString()).toBe('')
  })

  it("forgets another department's pages, so every tab starts on page 1", () => {
    const memory = { department: 'quality', pages: { recent: 4, others: 2 } }
    expect(rememberedPagesFor(memory, 'quality')).toEqual({ recent: 4, others: 2 })
    expect(rememberedPagesFor(memory, 'pharmacy')).toEqual({})
  })

  it('keeps the tab, search and filters but drops the page when switching department in the directory', () => {
    expect(searchWithoutPage('?tab=recent&q=gmp&type=pdf&page=3')).toBe('?tab=recent&q=gmp&type=pdf')
    expect(searchWithoutPage('?page=2')).toBe('')
    expect(searchWithoutPage('')).toBe('')
  })
})

describe('list state in the URL', () => {
  it('adds nothing for default values, and keeps the other parameters', () => {
    expect(updateParams(url(''), { tab: 'new', q: '', sort: 'newest', role: 'all', page: 1 }, MY_SOPS_URL_DEFAULTS).toString()).toBe('')
    expect(updateParams(url('tab=progress&q=a'), { page: 2 }, MY_SOPS_URL_DEFAULTS).toString()).toBe('tab=progress&q=a&page=2')
    expect(updateParams(url('tab=progress&page=2'), { page: 1 }, MY_SOPS_URL_DEFAULTS).toString()).toBe('tab=progress')
    expect(updateParams(url('q=backup'), { q: '' }, MY_SOPS_URL_DEFAULTS).toString()).toBe('')
  })

  it('reads one of the allowed values, otherwise the default', () => {
    expect(readChoice(url('sort=oldest'), 'sort', ['newest', 'oldest'] as const, 'newest')).toBe('oldest')
    expect(readChoice(url('sort=random'), 'sort', ['newest', 'oldest'] as const, 'newest')).toBe('newest')
  })

  it('restores My SOPs from the URL, with defaults for missing or invalid values', () => {
    expect(readMySopsUrl(url('tab=progress&q=backup%20plan&sort=oldest&role=coauthor&page=2')))
      .toEqual({ category: 'progress', query: 'backup plan', sort: 'oldest', role: 'coauthor', page: 2 })
    expect(readMySopsUrl(url(''))).toEqual({ category: 'new', query: '', sort: 'newest', role: 'all', page: 1 })
    expect(readMySopsUrl(url('tab=archived&sort=az&role=owner&page=x')))
      .toEqual({ category: 'new', query: '', sort: 'newest', role: 'all', page: 1 })
  })

  it('restores the directory from the URL, with defaults for missing or invalid values', () => {
    // An old link to the removed Others tab opens All.
    expect(readDirectoryUrl(url('tab=others&q=gmp&sort=oldest&page=3')))
      .toEqual({ tab: 'all', query: 'gmp', sort: 'oldest', divisions: [], departments: [], page: 3 })
    expect(readDirectoryUrl(url('tab=mine&sort=&page=-2')))
      .toEqual({ tab: 'all', query: '', sort: 'newest', divisions: [], departments: [], page: 1 })
    // An old link with the removed File Type filter: ignored.
    expect(readDirectoryUrl(url('tab=recent&q=gmp&sort=oldest&type=docx&page=3')))
      .toEqual({ tab: 'recent', query: 'gmp', sort: 'oldest', divisions: [], departments: [], page: 3 })
    expect(readDirectoryUrl(url('type=xls'))).toEqual({ tab: 'all', query: '', sort: 'newest', divisions: [], departments: [], page: 1 })
    // The System Admin's filters: ids separated by commas, each once, blanks ignored.
    expect(readDirectoryUrl(url('tab=recent&division=med,,med&dept=pv,it,,pv'))).toMatchObject({ divisions: ['med'], departments: ['pv', 'it'] })
  })
})

describe('lists in the URL', () => {
  it('reads values separated by commas, each once, and writes them back the same way', () => {
    expect(readList(url('dept=pv,it,,pv, qa '), 'dept')).toEqual(['pv', 'it', 'qa'])
    expect(readList(url(''), 'dept')).toEqual([])
    expect(listParam(['pv', 'it', 'pv'])).toBe('pv,it')
    expect(listParam([])).toBeUndefined()
  })
})
