import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FormDialog } from './FormDialog'
import { TextAreaField } from './TextAreaField'

// Renders the dialog busy or not: FormDialog's busy flag is its only useState starting at false.
const state = vi.hoisted(() => ({ busy: false }))
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>()
  return {
    ...react,
    useState: (initial: unknown) => (initial === false ? [state.busy, () => {}] : react.useState(initial)),
  }
})
beforeEach(() => { state.busy = false })

const dialog = (props: Partial<Parameters<typeof FormDialog>[0]> = {}) => renderToStaticMarkup(
  <FormDialog open title="Delete Backup Procedure" confirmLabel="Delete" cancelLabel="Cancel" onConfirm={() => {}} onClose={() => {}} {...props}>
    <TextAreaField name="reason" label="Justification" required requiredMark />
  </FormDialog>,
)
const buttons = (html: string) => html.match(/<button[^>]*>.*?<\/button>/g)!

describe('FormDialog', () => {
  it('keeps the primary confirm button and a closable Cancel by default', () => {
    const [cancel, confirm] = buttons(dialog())
    expect(confirm).toContain('bg-maroon')
    expect(confirm).toContain('>Delete</button>')
    expect(cancel).not.toContain('aria-disabled="true"')
  })

  it('can use the danger look for a destructive confirm button', () => {
    const [, confirm] = buttons(dialog({ confirmVariant: 'danger' }))
    expect(confirm).toContain('type="submit"')
    expect(confirm).toContain('text-status-rejected-fg')
    expect(confirm).not.toContain('bg-maroon')
  })

  it('starts on the first field: the field comes before the buttons', () => {
    const html = dialog({ confirmVariant: 'danger' })
    expect(html.indexOf('<textarea')).toBeLessThan(html.indexOf('<button'))
  })

  it('shows the busy label and spinner and refuses a second submit while busy', () => {
    state.busy = true
    const [cancel, confirm] = buttons(dialog({ confirmVariant: 'danger', busyLabel: 'Deleting…', lockWhileBusy: true }))
    expect(confirm).toContain('aria-disabled="true"')
    expect(confirm).toContain('lucide-loader-circle')
    expect(confirm).toContain('Deleting…</button>')
    // Cancel can't close it mid-action.
    expect(cancel).toContain('aria-disabled="true"')
  })

  it('lets Cancel close a busy dialog unless it is locked', () => {
    state.busy = true
    const [cancel, confirm] = buttons(dialog())
    expect(cancel).not.toContain('aria-disabled="true"')
    expect(confirm).toContain('aria-disabled="true"')
    expect(confirm).toContain('>Delete</button>')
  })
})
