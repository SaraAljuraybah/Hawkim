import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SelectCombobox } from './SelectCombobox'

const options = [{ value: 'qa', label: 'Quality Assurance' }, { value: 'pv', label: 'Pharmacovigilance' }]
const render = (props: { value?: string; error?: string; disabled?: boolean } = {}) => renderToStaticMarkup(
  <SelectCombobox label="Department" name="department" options={options} value={props.value ?? ''} onChange={() => {}} required requiredMark
    error={props.error} disabled={props.disabled} placeholder="Select or type a department" noMatchesText="No department matches." toggleLabel="Show departments" />)
const input = (html: string) => html.match(/<input[^>]*>/)![0]

describe('SelectCombobox', () => {
  it('labels a required editable combobox that controls a closed listbox', () => {
    const html = render()
    const list = html.match(/<ul[^>]*>/)![0]
    const label = html.match(/<label[^>]*for="([^"]+)"[^>]*>Department(.*?)<\/label>/)!
    expect(input(html)).toContain(`id="${label[1]}"`)
    expect(label[2]).toContain('>*<')
    expect(input(html)).toContain('role="combobox"')
    expect(input(html)).toContain('aria-expanded="false"')
    expect(input(html)).toContain('aria-autocomplete="list"')
    expect(input(html)).toContain('required=""')
    expect(input(html)).toContain(`aria-controls="${list.match(/id="([^"]+)"/)![1]}"`)
    expect(list).toContain('role="listbox"')
    expect(list).toContain('hidden=""')
  })

  it('offers every option, nothing highlighted, with a named toggle outside the tab order', () => {
    const html = render()
    expect(html.match(/role="option"/g)).toHaveLength(2)
    expect(html).not.toContain('aria-selected="true"')
    const toggle = html.match(/<button[^>]*>/)![0]
    expect(toggle).toContain('aria-label="Show departments"')
    expect(toggle).toContain('tabindex="-1"')
  })

  it('shows the chosen option by name, and nothing when none is chosen', () => {
    expect(input(render({ value: 'pv' }))).toContain('value="Pharmacovigilance"')
    expect(input(render())).toContain('value=""')
    expect(input(render())).toContain('placeholder="Select or type a department"')
  })

  it('links its error to the input', () => {
    const html = render({ error: 'Select a department from the list.' })
    const errorId = html.match(/<p id="([^"]+)"[^>]*>.*?Select a department from the list\./)![1]
    expect(input(html)).toContain('aria-invalid="true"')
    expect(input(html)).toContain(`aria-describedby="${errorId}"`)
  })

  it('can be disabled, toggle included', () => {
    const html = render({ disabled: true })
    expect(input(html)).toContain('disabled=""')
    expect(html.match(/<button[^>]*>/)![0]).toContain('disabled=""')
  })
})
