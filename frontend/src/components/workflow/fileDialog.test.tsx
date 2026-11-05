import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { adminEn } from '../../content/admin.en'
import { appShellEn, dashboardEn } from '../../content/app.en'
import { mySopsEn, uploadSopEn } from '../../content/mySops.en'
import { reviewsEn } from '../../content/reviews.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import { FileDialog } from './FileDialog'

const dialog = sopWorkflowEn.dialogs

/** Every visible text in a content object (links' addresses and icon names aren't visible). */
function texts(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(texts)
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => (key === 'href' || key === 'icon' ? [] : texts(item)))
  return []
}

describe('Add SOP for a new version', () => {
  it('says which version is being added, with Add SOP as the title and the button', () => {
    const html = renderToStaticMarkup(
      <FileDialog content={dialog} title={dialog.newVersion.title} description={dialog.newVersion.description.replace('{version}', '3')}
        confirmLabel={dialog.newVersion.confirm} onSubmit={() => {}} onClose={() => {}} />,
    )
    expect(html).toContain('>Add SOP</h2>')
    expect(html).toContain('You are adding v3. Choose the file with your changes.')
    expect(html).toMatch(/<button type="submit"[^>]*>Add SOP<\/button>/)
    expect(sopWorkflowEn.history.upload).toBe('Add SOP')
    expect(sopWorkflowEn.messages.newVersion).toBe('v{version} added.')
  })

  it('marks the SOP File required, like the Add SOP page', () => {
    const html = renderToStaticMarkup(
      <FileDialog content={dialog} title="Add SOP" description="You are adding v2." confirmLabel="Add SOP" onSubmit={() => {}} onClose={() => {}} />,
    )
    expect(html).toContain('<span aria-hidden="true" class="ml-0.5 text-status-rejected-fg">*</span>')
    expect(html).toContain('<span class="sr-only"> (required)</span>')
    expect(dialog.fileRequired).toBe('Add an SOP file.')
  })
})

describe('"add" instead of "upload" for SOPs and versions', () => {
  it('uses Add SOP for a new SOP', () => {
    expect(uploadSopEn).toMatchObject({ pageTitle: 'Add SOP | Hawkim', title: 'Add SOP', submit: { label: 'Add SOP', loadingLabel: 'Adding…' } })
    expect(mySopsEn.upload.label).toBe('Add SOP')
    expect(mySopsEn.uploadedMessage).toBe('SOP added as a draft.')
    // The dashboard's Quick Action.
    expect(dashboardEn.quickActions.secondary.find((item) => item.href === '/my-sops/upload')?.label).toBe('Add SOP')
    expect(adminEn.permissionDescriptions.author).toBe('Adds SOPs, works on them with co-authors and submits them for review.')
  })

  it('leaves no visible "upload" about SOPs or versions; the file drop area keeps its wording', () => {
    for (const content of [mySopsEn, uploadSopEn, sopWorkflowEn, reviewsEn, appShellEn, dashboardEn, adminEn.permissionDescriptions]) {
      expect(texts(content).filter((text) => /upload/i.test(text))).toEqual([])
    }
    expect(uploadSopEn.fields.file).toMatchObject({ dropPrompt: 'Drag and drop the file here, or', browse: 'browse', hint: '.docx or PDF, up to 10 MB' })
    expect(dialog.fileField.typeError).toBe("This file type isn't supported. Add a .docx or PDF file.")
  })
})
