import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Funnel } from 'lucide-react'
import { MultiSelectField } from './MultiSelectField'
import { toggleOption } from './multiSelect'

const options = [{ value: 'user-noura', label: 'Noura Alqahtani' }, { value: 'user-huda', label: 'Huda Alotaibi' }]

describe('MultiSelectField', () => {
  it('makes each whole option row a label for its checkbox, with the pointer cursor', () => {
    const html = renderToStaticMarkup(
      <MultiSelectField name="internalReviewers" label="Select reviewers" placeholder="Select reviewers" emptyText="None" options={options} value={['user-huda']} onChange={() => {}} />)
    const rows = [...html.matchAll(/<label[^>]*>(.*?)<\/label>/g)]
    expect(rows).toHaveLength(2)
    for (const [row, inner] of rows) {
      expect(row).toContain('cursor-pointer')
      // The checkbox sits inside the label, so the name is its accessible name.
      expect(inner).toMatch(/^<input[^>]*type="checkbox"/)
    }
    expect(rows[0][1]).toContain('>Noura Alqahtani<')
    expect(rows[1][1]).toMatch(/checked=""/)
  })

  it('toggles one option for a click on its row, Space or Enter, keeping the others', () => {
    expect(toggleOption([], 'user-noura')).toEqual(['user-noura'])
    expect(toggleOption(['user-huda'], 'user-noura')).toEqual(['user-huda', 'user-noura'])
    expect(toggleOption(['user-huda', 'user-noura'], 'user-huda')).toEqual(['user-noura'])
    expect(toggleOption(toggleOption(['user-huda'], 'user-noura'), 'user-noura')).toEqual(['user-huda'])
  })
})

describe('MultiSelectField icon trigger', () => {
  const icon = (value: string[], buttonLabel?: string) => renderToStaticMarkup(
    <MultiSelectField trigger="icon" icon={Funnel} name="roles" label="Filter by role" buttonLabel={buttonLabel} placeholder="Filter by role"
      emptyText="None" options={options} value={value} onChange={() => {}} />)
  const button = (html: string) => html.match(/<button[^>]*>.*?<\/button>/)![0]

  it('is a 40px icon button named by its label, with an outline icon while nothing is selected', () => {
    const html = button(icon([]))
    expect(html).toMatch(/aria-label="Filter by role" aria-expanded="false" aria-controls="[^"]+"/)
    expect(html).toContain('size-10')
    expect(html).toContain('bg-white text-maroon')
    expect(html).toMatch(/<svg[^>]*fill="none"[^>]*lucide-funnel|<svg[^>]*lucide-funnel[^>]*fill="none"/)
    expect(html).not.toContain('Noura Alqahtani')
  })
  it('is filled and highlighted while something is selected, with the count in its accessible name only', () => {
    const html = button(icon(['user-huda', 'user-noura'], 'Filter by role, 2 selected'))
    expect(html).toContain('aria-label="Filter by role, 2 selected"')
    expect(html).toContain('bg-maroon text-offwhite')
    expect(html).toMatch(/<svg[^>]*fill="currentColor"/)
    // No visible count badge.
    expect(html.replace(/<[^>]+>/g, '')).toBe('')
  })
  it('keeps a visible focus ring outside the button in both states (offset onto the card background)', () => {
    for (const html of [button(icon([])), button(icon(['user-huda']))]) {
      expect(html).toContain('focus-visible:outline-2')
      expect(html).toContain('focus-visible:outline-offset-2')
      expect(html).toContain('focus-visible:outline-maroon-secondary')
    }
  })
  it('opens the same checkbox list, anchored to the button\'s right edge so it stays inside the card', () => {
    const html = icon(['user-huda'])
    expect(html).toMatch(/<div id="[^"]+" role="group" aria-label="Filter by role" hidden=""[^>]*right-0 w-48/)
    expect([...html.matchAll(/type="checkbox"/g)]).toHaveLength(2)
  })
  it('leaves the default field trigger unchanged', () => {
    const html = renderToStaticMarkup(
      <MultiSelectField name="r" label="Select reviewers" placeholder="Select reviewers" emptyText="None" options={options} value={[]} onChange={() => {}} />)
    expect(html).toContain('>Select reviewers</span>')
    expect(html).toContain('inset-x-0')
    expect(html).not.toContain('size-10')
  })
})
