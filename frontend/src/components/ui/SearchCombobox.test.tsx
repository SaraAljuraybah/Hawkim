import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SearchCombobox } from './SearchCombobox'

const render = () => renderToStaticMarkup(
  <SearchCombobox label="Search SOPs" name="search" value="" onChange={() => {}} options={['Document Control', 'Access Control']} placeholder="Search by SOP title" noMatchesText="No matching SOPs" toggleLabel="Show SOP titles" />)

describe('SearchCombobox', () => {
  it('labels an editable combobox that controls a closed listbox', () => {
    const html = render()
    const input = html.match(/<input[^>]*>/)![0]
    const list = html.match(/<ul[^>]*>/)![0]
    const label = html.match(/<label[^>]*for="([^"]+)"[^>]*>Search SOPs<\/label>/)!
    expect(input).toContain(`id="${label[1]}"`)
    expect(input).toContain('role="combobox"')
    expect(input).toContain('aria-expanded="false"')
    expect(input).toContain('aria-autocomplete="list"')
    expect(input).toContain(`aria-controls="${list.match(/id="([^"]+)"/)![1]}"`)
    expect(input).toContain('type="text"')
    expect(list).toContain('role="listbox"')
    expect(list).toContain('hidden=""')
  })

  it('offers each suggestion as an option, nothing highlighted, with a named toggle outside the tab order', () => {
    const html = render()
    expect(html.match(/role="option"/g)).toHaveLength(2)
    expect(html).not.toContain('aria-selected="true"')
    const toggle = html.match(/<button[^>]*>/)![0]
    expect(toggle).toContain('aria-label="Show SOP titles"')
    expect(toggle).toContain('tabindex="-1"')
    expect(toggle).toContain('type="button"')
  })
})
