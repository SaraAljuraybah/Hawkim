import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DepartmentBadge } from './DepartmentBadge'

describe('DepartmentBadge', () => {
  it('always shows initials generated from the name, never the saved initials', () => {
    const html = renderToStaticMarkup(<DepartmentBadge department={{ name: 'Clinical Operations', initials: 'XYZ' } as { name: string }} />)
    expect(html).toMatch(/aria-hidden="true"[^>]*>CO<\/span>/)
  })
  it('follows a rename', () => {
    expect(renderToStaticMarkup(<DepartmentBadge department={{ name: 'Research and Development' }} />)).toContain('>RD</span>')
  })
})
