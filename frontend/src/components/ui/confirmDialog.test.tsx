import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConfirmDialog } from './ConfirmDialog'

const dialog = (prominent = false) => renderToStaticMarkup(
  <ConfirmDialog open prominent={prominent} title="Discard unsaved changes?" description="You have unsaved changes."
    cancelLabel="Keep Editing" confirmLabel="Discard Changes" onConfirm={() => {}} onCancel={() => {}} />,
)

describe('ConfirmDialog text sizes', () => {
  it('shows the message as small body text (14px) under the larger title', () => {
    const html = dialog()
    expect(html).toMatch(/<h2 id="[^"]+" class="text-lg">Discard unsaved changes\?<\/h2>/)
    expect(html).toMatch(/<div id="[^"]+" class="mt-2 text-sm text-text-gray"><p>You have unsaved changes\.<\/p><\/div>/)
  })

  it('keeps the prominent style as it was (larger title, 14px message, left-aligned)', () => {
    const html = dialog(true)
    expect(html).toMatch(/<h2 id="[^"]+" class="text-left text-xl break-words sm:text-2xl">/)
    expect(html).toMatch(/<div id="[^"]+" class="mt-3 text-left text-sm text-text-gray">/)
  })
})
