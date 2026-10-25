import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
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
