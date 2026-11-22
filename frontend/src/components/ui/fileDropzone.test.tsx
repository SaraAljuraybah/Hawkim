import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileDropzone, type FileDropzoneText } from './FileDropzone'
import { GUIDELINE_FILE_MAX_BYTES, SOP_FILE_MAX_BYTES } from '../../lib/fileLimits'
import { formatFileSize } from '../../lib/format'
import { uploadSopEn } from '../../content/mySops.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import { adminEn } from '../../content/admin.en'

// The component is called as a function with stand-in hooks, so its input handler can be driven without a DOM.
const host = vi.hoisted(() => ({ states: [] as unknown[], index: 0 }))
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useState: (initial: unknown) => {
  const index = host.index++
  if (!(index in host.states)) host.states[index] = initial
  return [host.states[index], (value: unknown) => { host.states[index] = value }]
}, useRef: (initial: unknown) => ({ current: initial }), useId: () => 'id' }))
beforeEach(() => { host.states = []; host.index = 0 })

type Element = ReactElement<Record<string, unknown>>
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
/** A file of exactly `size` bytes, without allocating it. */
function sized(name: string, size: number): File {
  const file = new File(['x'], name)
  Object.defineProperty(file, 'size', { value: size })
  return file
}
function zone(maxSizeBytes: number, text: FileDropzoneText = uploadSopEn.fields.file, extensions = ['.docx', '.pdf']) {
  const onChange = vi.fn()
  const render = () => { host.index = 0; return FileDropzone({ files: [], onChange, extensions, maxSizeBytes, text, multiple: false }) as Element }
  const choose = (file: File) => {
    const input = elements(render()).find((item) => item.type === 'input')!
    ;(input.props.onChange as (event: unknown) => void)({ target: { files: [file], value: '' } })
  }
  const shown = () => renderToStaticMarkup(render())
  return { onChange, choose, shown }
}

describe.each([
  ['SOP file (Add SOP and new versions)', SOP_FILE_MAX_BYTES, uploadSopEn.fields.file, ['.docx', '.pdf'], 'procedure.pdf', '10 MB'],
  ['GVP guideline PDF', GUIDELINE_FILE_MAX_BYTES, adminEn.regulationForm.file, ['.pdf'], 'gvp.pdf', '20 MB'],
])('%s size limit, checked when the file is chosen (before any upload)', (_, max, text, extensions, name, label) => {
  it('accepts a file below the limit', () => {
    const { onChange, choose } = zone(max, text, extensions)
    choose(sized(name, max - 1))
    expect(onChange).toHaveBeenCalledOnce()
  })
  it('accepts a file exactly at the limit', () => {
    const { onChange, choose, shown } = zone(max, text, extensions)
    choose(sized(name, max))
    expect(onChange).toHaveBeenCalledOnce()
    expect(shown()).not.toContain('too large')
  })
  it('refuses a file one byte over the limit and says the limit', () => {
    const { onChange, choose, shown } = zone(max, text, extensions)
    choose(sized(name, max + 1))
    expect(onChange).not.toHaveBeenCalled()
    expect(shown()).toContain(`${name} is too large. Files must be ${label} or smaller.`)
  })
})

describe('file size limits', () => {
  it('match the Storage buckets exactly, in bytes', () => {
    expect(SOP_FILE_MAX_BYTES).toBe(10485760)
    expect(GUIDELINE_FILE_MAX_BYTES).toBe(20971520)
  })
  it('are the ones the hints state', () => {
    expect(uploadSopEn.fields.file.hint).toContain('up to 10 MB')
    expect(sopWorkflowEn.dialogs.fileField.hint).toContain('up to 10 MB')
    expect(adminEn.regulationForm.file.hint).toContain('up to 20 MB')
  })
  it('names the limit when the database refuses a GVP PDF as too large (not "check your connection")', () => {
    expect(adminEn.regulationForm.errors.fileTooLarge.replace('{max}', formatFileSize(GUIDELINE_FILE_MAX_BYTES)))
      .toBe('The file is too large. Files must be 20 MB or smaller.')
    expect(formatFileSize(SOP_FILE_MAX_BYTES)).toBe('10 MB')
  })
})
