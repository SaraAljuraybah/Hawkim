import { describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { paginationEn } from '../../content/pagination.en'
import { Pagination } from './Pagination'

const render = (page: number, count: number, total = count * 12) => renderToStaticMarkup(<Pagination page={page} count={count} total={total} onChange={() => {}} content={paginationEn} />)

/** The page buttons in one of the two lists (phones, or from sm). */
function pageList(html: string, shown: 'flex sm:hidden' | 'hidden sm:flex'): string[] {
  const list = html.match(new RegExp(`<ul class="items-center gap-1 ${shown}">(.*?)</ul>`))![1]
  return [...list.matchAll(/<li[^>]*>(?:<button[^>]*>)?([^<]+)/g)].map((match) => match[1])
}

/** Calls the component, then finds the button with this accessible name, to press it without a DOM. */
function pressButton(label: string, page: number, count: number) {
  const onChange = vi.fn()
  const find = (node: ReactNode): ReactElement<{ onClick: () => void }> | undefined => {
    if (Array.isArray(node)) return node.map(find).find(Boolean)
    if (!isValidElement(node)) return undefined
    const props = node.props as { 'aria-label'?: string; children?: ReactNode }
    if (props['aria-label'] === label) return node as ReactElement<{ onClick: () => void }>
    return find(props.children)
  }
  find(Pagination({ page, count, total: count * 12, onChange, content: paginationEn }))!.props.onClick()
  return onChange
}

describe('Pagination', () => {
  it('is hidden only when the list has no results', () => {
    expect(render(1, 1, 0)).toBe('')
    expect(render(1, 0, 0)).toBe('')
  })

  it('shows "‹ Previous 1 Next ›" for a single page, with Previous and Next disabled but still focusable', () => {
    for (const total of [1, 12]) {
      const html = render(1, 1, total)
      expect(html).toMatch(/^<nav aria-label="Pagination"/)
      expect(pageList(html, 'hidden sm:flex')).toEqual(['1'])
      expect(pageList(html, 'flex sm:hidden')).toEqual(['1'])
      expect(html).toMatch(/aria-label="Page 1" aria-current="page"/)
      const previous = html.match(/<button[^>]*aria-label="Previous page"[^>]*>/)![0]
      const next = html.match(/<button[^>]*aria-label="Next page"[^>]*>/)![0]
      for (const button of [previous, next]) {
        expect(button).toContain('aria-disabled="true"')
        expect(button).not.toMatch(/ disabled=""/)
        // Gray text on beige at full opacity (about 6.2:1).
        expect(button).toContain('aria-disabled:bg-beige aria-disabled:text-text-gray')
      }
      expect(html).toContain('>Previous</span>')
      expect(html).toContain('>Next</span>')
    }
  })

  it('does nothing when the disabled Previous or Next of a single page is pressed', () => {
    expect(pressButton('Previous page', 1, 1)).not.toHaveBeenCalled()
    expect(pressButton('Next page', 1, 1)).not.toHaveBeenCalled()
  })

  it('is a navigation landmark named Pagination, with Previous, the page numbers and Next', () => {
    const html = render(2, 3)
    expect(html).toMatch(/^<nav aria-label="Pagination"/)
    expect(html).toContain('aria-label="Previous page"')
    expect(html).toContain('aria-label="Next page"')
    expect(html).toContain('>Previous</span>')
    expect(html).toContain('>Next</span>')
    for (const page of [1, 2, 3]) expect(html).toContain(`aria-label="Page ${page}"`)
    expect(html).not.toContain('Showing')
  })

  it('marks the current page with aria-current, a filled look and bold text', () => {
    const html = render(2, 3)
    const current = html.match(/<button[^>]*aria-current="page"[^>]*>2<\/button>/g)!
    expect(current).toHaveLength(2) // the phone and the wider list
    expect(current[0]).toContain('bg-maroon text-offwhite')
    expect(current[0]).toContain('font-semibold')
    expect(html.match(/aria-current="page"/g)).toHaveLength(2)
    expect(html).not.toMatch(/aria-label="Page 1"[^>]*aria-current/)
  })

  it('makes Previous unavailable on the first page and Next on the last, while keeping them focusable', () => {
    const first = render(1, 3)
    expect(first.match(/<button[^>]*aria-label="Previous page"[^>]*>/)![0]).toContain('aria-disabled="true"')
    expect(first.match(/<button[^>]*aria-label="Next page"[^>]*>/)![0]).not.toContain('aria-disabled="true"')
    const last = render(3, 3)
    expect(last.match(/<button[^>]*aria-label="Next page"[^>]*>/)![0]).toContain('aria-disabled="true"')
    expect(last.match(/<button[^>]*aria-label="Previous page"[^>]*>/)![0]).not.toContain('aria-disabled="true"')
    expect(first).not.toMatch(/ disabled=""/)
  })

  it('shows gaps as a hidden "…", and fewer page numbers on phones', () => {
    const html = render(5, 20)
    expect(pageList(html, 'hidden sm:flex')).toEqual(['1', '…', '4', '5', '6', '…', '20'])
    expect(pageList(html, 'flex sm:hidden')).toEqual(['1', '…', '5', '…', '20'])
    expect(html).toContain('<li aria-hidden="true"')
  })

  it('shows only the arrows of Previous and Next on phones, and keeps every control at least 40px', () => {
    const html = render(2, 3)
    expect(html).toContain('<span class="hidden sm:inline">Previous</span>')
    expect(html).toContain('<span class="hidden sm:inline">Next</span>')
    for (const button of html.match(/<button[^>]*>/g)!) {
      expect(button).toContain('h-10')
      expect(button).toContain('min-w-10')
    }
  })

  it('changes to the page pressed, and does nothing for an unavailable Previous or Next', () => {
    expect(pressButton('Page 3', 1, 3)).toHaveBeenCalledWith(3)
    expect(pressButton('Next page', 1, 3)).toHaveBeenCalledWith(2)
    expect(pressButton('Previous page', 3, 3)).toHaveBeenCalledWith(2)
    expect(pressButton('Previous page', 1, 3)).not.toHaveBeenCalled()
    expect(pressButton('Next page', 3, 3)).not.toHaveBeenCalled()
    expect(pressButton('Page 2', 2, 3)).not.toHaveBeenCalled()
  })
})
