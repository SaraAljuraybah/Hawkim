import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sopWorkflowEn } from '../../content/workflow.en'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { TextAreaField } from '../ui/TextAreaField'
import { SopDescription } from './SopDescription'

type Slot = { value: unknown }
const fixture = vi.hoisted(() => ({ slots: [] as Slot[], index: 0 }))

// Keep the component's state across calls, so its handlers can be exercised without a DOM.
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>()
  const slot = (initial: () => unknown) => {
    const index = fixture.index++
    return fixture.slots[index] ?? (fixture.slots[index] = { value: initial() })
  }
  return { ...react,
    useState: (initial: unknown) => {
      const item = slot(() => typeof initial === 'function' ? initial() : initial)
      return [item.value, (next: unknown) => { item.value = typeof next === 'function' ? next(item.value) : next }]
    },
    useRef: (initial: unknown) => slot(() => ({ current: initial })).value,
    useEffect: () => {},
  }
})

const content = sopWorkflowEn.description

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as ReactElement<Record<string, unknown>>, ...elements(node.props.children)]
}
function call(props: Parameters<typeof SopDescription>[0]) {
  fixture.index = 0
  return SopDescription(props)
}
const html = (props: Parameters<typeof SopDescription>[0]) => {
  fixture.index = 0
  return renderToStaticMarkup(<SopDescription {...props} />)
}
const of = (tree: ReactNode, type: unknown) => elements(tree).filter((node) => node.type === type)
const button = (tree: ReactNode, label: string) => of(tree, Button).find((node) => node.props.children instanceof Array
  ? (node.props.children as ReactNode[]).includes(label) : node.props.children === label)!

const edit = (tree: ReactNode) => (of(tree, IconButton)[0].props.onClick as () => void)()

beforeEach(() => {
  fixture.slots = []
  fixture.index = 0
})

describe('SOP description', () => {
  it('shows the text as body text at a reading width, without the small grey meta style', () => {
    const markup = html({ description: 'Covers adverse event intake.\nSecond line.', content })
    expect(markup).toContain('Covers adverse event intake.\nSecond line.')
    expect(markup).toMatch(/^<p class="mt-3 max-w-prose [^"]*whitespace-pre-wrap[^"]*text-maroon"/)
    expect(markup).not.toContain('text-sm')
    expect(markup).not.toContain('text-text-gray')
    expect(markup).not.toContain(content.edit)
  })

  it('puts the edit button right after the last word, as an icon-only button with a 24px target', () => {
    const markup = html({ description: 'Current text', content, onSave: vi.fn() })
    // Inside the same paragraph, straight after the text, with a small gap.
    expect(markup).toMatch(/^<p [^>]*>Current text<span class="ml-1 inline-flex align-middle">/)
    const button = markup.match(/<button [^>]*>/)![0]
    expect(button).toContain('type="button"')
    expect(button).toContain(`aria-label="${content.edit}"`)
    const classes = button.match(/class="([^"]+)"/)![1].split(' ')
    expect(classes).toEqual(expect.arrayContaining(['size-6', 'text-text-gray', 'hover:text-maroon']))
    expect(classes.some((name) => name === 'border' || name.startsWith('border-') || name.startsWith('bg-') || name.startsWith('hover:bg-'))).toBe(false)
    expect(markup).toContain(`role="tooltip" hidden=""`)
    expect(markup).toContain(`>${content.edit}<`)
  })

  it('shows nothing at all when empty, not even the edit button', () => {
    expect(html({ description: '  ', content })).toBe('')
    expect(html({ description: '', content, onSave: vi.fn() })).toBe('')
    expect(html({ content, onSave: vi.fn() })).toBe('')
  })

  it('opens a textarea with the description, its limit and counter, Save and Cancel', () => {
    const onSave = vi.fn(async () => {})
    edit(call({ description: 'Current text', content, onSave }))
    const editing = call({ description: 'Current text', content, onSave })
    const field = of(editing, TextAreaField)[0].props
    expect(field).toMatchObject({ label: content.label, value: 'Current text', maxLength: 1000, counter: '12 / 1000' })
    expect(button(editing, content.save)).toBeDefined()
    expect(button(editing, content.cancel)).toBeDefined()
    expect(of(editing, IconButton)).toHaveLength(0)
    // The textarea uses the full row width, with Save and Cancel below it.
    const markup = renderToStaticMarkup(<>{editing}</>)
    expect(markup).toMatch(/^<div class="mt-3">/)
    expect(markup).not.toContain('max-w-prose')
    expect(markup.indexOf('<textarea')).toBeLessThan(markup.indexOf('>Save<'))
  })

  it('cancels with Escape or Cancel and keeps the original text', () => {
    const onSave = vi.fn(async () => {})
    const props = { description: 'Current text', content, onSave }
    edit(call(props))
    ;(of(call(props), TextAreaField)[0].props.onChange as (event: unknown) => void)({ target: { value: 'Changed' } })
    const editing = call(props) as ReactElement<{ onKeyDown: (event: unknown) => void }>
    editing.props.onKeyDown({ key: 'Escape', stopPropagation: () => {} })
    expect(of(call(props), TextAreaField)).toHaveLength(0)
    expect(html(props)).toContain('Current text')

    edit(call(props))
    expect(of(call(props), TextAreaField)[0].props.value).toBe('Current text')
    ;(button(call(props), content.cancel).props.onClick as () => void)()
    expect(of(call(props), TextAreaField)).toHaveLength(0)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves the new text, then closes and calls onSaved', async () => {
    const onSave = vi.fn(async () => {})
    const onSaved = vi.fn()
    const props = { description: 'Current text', content, onSave, onSaved }
    edit(call(props))
    ;(of(call(props), TextAreaField)[0].props.onChange as (event: unknown) => void)({ target: { value: 'New text' } })
    expect(of(call(props), TextAreaField)[0].props.counter).toBe('8 / 1000')
    await (button(call(props), content.save).props.onClick as () => Promise<void>)()
    expect(onSave).toHaveBeenCalledExactlyOnceWith('New text')
    expect(onSaved).toHaveBeenCalledOnce()
    expect(of(call(props), TextAreaField)).toHaveLength(0)
  })

  it('closes without saving when nothing changed', async () => {
    const onSave = vi.fn(async () => {})
    const onSaved = vi.fn()
    const props = { description: 'Current text', content, onSave, onSaved }
    edit(call(props))
    await (button(call(props), content.save).props.onClick as () => Promise<void>)()
    expect(onSave).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(of(call(props), TextAreaField)).toHaveLength(0)
  })

  it('stays open with an error when saving fails', async () => {
    const onSave = vi.fn(async () => { throw new Error('Refused') })
    const onSaved = vi.fn()
    const props = { description: 'Current text', content, onSave, onSaved }
    edit(call(props))
    ;(of(call(props), TextAreaField)[0].props.onChange as (event: unknown) => void)({ target: { value: 'First description' } })
    await (button(call(props), content.save).props.onClick as () => Promise<void>)()
    expect(onSaved).not.toHaveBeenCalled()
    const failed = renderToStaticMarkup(<>{call(props)}</>)
    expect(failed).toContain('role="alert"')
    expect(failed).toContain(content.failed.replace("'", '&#x27;'))
    expect(of(call(props), TextAreaField)[0].props.value).toBe('First description')
  })
})
