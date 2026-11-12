import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Department, User } from '../data/mock/types'
import { UploadSopPage } from './UploadSopPage'

const fixture = vi.hoisted(() => ({
  home: { id: 'pv', name: 'Pharmacovigilance', initials: 'PV', description: '', divisionId: 'medical', divisionName: 'Medical Affairs' } as Department,
}))
const author: User = { id: 'author', name: 'Author', email: 'author@example.test', initials: 'AU', permissions: ['author'], departmentId: 'pv' }
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => author }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ addDraft: vi.fn() }) }))
vi.mock('../state/activeDepartmentContext', () => ({ useActiveDepartment: () => ({ activeDepartment: fixture.home, homeDepartment: fixture.home }) }))

const render = () => renderToStaticMarkup(<MemoryRouter><UploadSopPage /></MemoryRouter>)
/** The red asterisk of the required fields, hidden from screen readers. */
const MARK = '<span aria-hidden="true" class="ml-0.5 text-status-rejected-fg">*</span>'
const MARK_PATTERN = MARK.replace(/[.*]/g, (character) => `\\${character}`)
/** The read-only value shown under a label (with its asterisk), styled like Department. */
const value = (html: string, label: string) =>
  html.match(new RegExp(`<p class="mb-1.5 text-sm font-medium text-maroon">${label}${MARK_PATTERN}</p><p class="([^"]+)">(.*?)</p>`))

beforeEach(() => vi.useFakeTimers({ now: new Date('2026-11-12T10:00:00+03:00') }))
afterEach(() => vi.useRealTimers())

describe('the read-only fields on Add SOP', () => {
  it('shows Division, Department and Added to Hawkim On in the same read-only style, in that order', () => {
    const html = render()
    const department = value(html, 'Department')!
    const division = value(html, 'Division')!
    const added = value(html, 'Added to Hawkim On')!
    expect(division[2]).toBe('Medical Affairs')
    expect(department[2]).toBe('Pharmacovigilance')
    expect(added[2]).toBe('<time dateTime="2026-11-12">Nov 12, 2026</time>')
    for (const field of [division, added]) expect(field[1]).toBe(department[1])
    expect(department[1]).toBe('rounded-lg border border-beige bg-beige/50 px-3.5 py-2.5 text-[0.9375rem] text-maroon')
    expect(html.indexOf('>Division<')).toBeLessThan(html.indexOf('>Department<'))
    expect(html.indexOf('>Department<')).toBeLessThan(html.indexOf('>Added to Hawkim On<'))
  })

  it('says No Division when the department has none', () => {
    fixture.home = { ...fixture.home, divisionId: undefined, divisionName: undefined }
    expect(value(render(), 'Division')![2]).toBe('No Division')
    fixture.home = { ...fixture.home, divisionId: 'medical', divisionName: 'Medical Affairs' }
  })

  it('uses the date in Riyadh, which can be a day ahead of UTC', () => {
    // 22:30 UTC on 12 November is 01:30 on 13 November in Riyadh.
    vi.setSystemTime(new Date('2026-11-12T22:30:00Z'))
    expect(value(render(), 'Added to Hawkim On')![2]).toBe('<time dateTime="2026-11-13">Nov 13, 2026</time>')
  })

  it('marks all three with the red required asterisk of Title and SOP File, for the eye only', () => {
    const html = render()
    for (const label of ['Division', 'Department', 'Added to Hawkim On']) expect(value(html, label)).not.toBeNull()
    // The same mark as Title (FieldShell) and SOP File use.
    expect(html.match(/<label[^>]*>Title(<span[^>]*>\*<\/span>)<\/label>/)![1]).toBe(MARK)
    // Not inputs: nothing tells screen readers they must be filled in.
    expect(html).not.toMatch(/aria-required="true"[^>]*name="(division|department|addedOn)"/)
    expect(html.match(/aria-hidden="true" class="ml-0.5 text-status-rejected-fg">\*</g)!.length).toBeGreaterThanOrEqual(5)
  })

  it('sends none of them: they are text, not form fields', () => {
    const html = render()
    const names = [...html.matchAll(/<(?:input|textarea|select)[^>]*name="([^"]+)"/g)].map((match) => match[1])
    expect(names).toEqual(['title', 'description'])
  })
})
