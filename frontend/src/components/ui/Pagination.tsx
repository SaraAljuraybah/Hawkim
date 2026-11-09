import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PaginationContent } from '../../content/types'
import { pageItems, type PageItem } from '../../lib/pagination'
import { Button } from './Button'

interface PaginationProps {
  /** The page shown (already within 1..count). */
  page: number
  /** How many pages the list has. Nothing is shown for a single page. */
  count: number
  onChange: (page: number) => void
  content: PaginationContent
  className?: string
}

/**
 * "‹ Previous", the page numbers and "Next ›" under a long list. The current page has
 * aria-current="page" and a filled look with bold text (not colour alone); every control is at
 * least 40px. Phones show fewer page numbers, and Previous/Next as arrows only (they keep their
 * accessible names). Previous and Next stay focusable when unavailable (aria-disabled).
 */
export function Pagination({ page, count, onChange, content, className = '' }: PaginationProps) {
  if (count <= 1) return null

  function go(next: number) {
    if (next >= 1 && next <= count && next !== page) onChange(next)
  }

  function numbers(items: PageItem[], shownClass: string) {
    return (
      <ul className={`items-center gap-1 ${shownClass}`}>
        {items.map((item) =>
          typeof item === 'number' ? (
            <li key={item}>
              <Button
                variant={item === page ? 'primary' : 'secondary'}
                aria-label={content.page.replace('{page}', String(item))}
                aria-current={item === page ? 'page' : undefined}
                onClick={() => go(item)}
                className={`min-w-10 px-2 ${item === page ? 'font-semibold' : ''}`}
              >
                {item}
              </Button>
            </li>
          ) : (
            <li key={item} aria-hidden="true" className="inline-flex size-10 items-center justify-center text-sm text-text-gray">
              …
            </li>
          ),
        )}
      </ul>
    )
  }

  const first = page === 1
  const last = page === count
  return (
    <nav aria-label={content.label} className={`flex items-center justify-center gap-1 sm:gap-2 ${className}`}>
      <Button variant="secondary" grayWhenDisabled aria-label={content.previousPage} aria-disabled={first || undefined}
        onClick={() => go(page - 1)} className="min-w-10 px-2 sm:px-3">
        <ChevronLeft aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
        <span className="hidden sm:inline">{content.previous}</span>
      </Button>
      {/* Phones: only the current page between the first and the last; from sm, one page each side. */}
      {numbers(pageItems(page, count, 0), 'flex sm:hidden')}
      {numbers(pageItems(page, count, 1), 'hidden sm:flex')}
      <Button variant="secondary" grayWhenDisabled aria-label={content.nextPage} aria-disabled={last || undefined}
        onClick={() => go(page + 1)} className="min-w-10 px-2 sm:px-3">
        <span className="hidden sm:inline">{content.next}</span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
      </Button>
    </nav>
  )
}
