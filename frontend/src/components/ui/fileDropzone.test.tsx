import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
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
const textOf = (node: ReactNode): string => Array.isArray(node) ? node.map(textOf).join('')
  : isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : typeof node === 'string' ? node : ''
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
  /** The refusals listed under the zone. */
  const refusals = () => elements(render()).filter((item) => item.type === 'li').map((item) => textOf(item.props.children as ReactNode))
  /** The texts with an id (the label, the hint; useId is 'id' here), to find the hint among them. */
  const labelled = () => elements(render()).filter((item) => item.props.id === 'id').map((item) => item.props.children)
  return { onChange, choose, refusals, labelled }
}
const MB = 1024 * 1024

describe.each([
  ['Add SOP', uploadSopEn.fields.file, SOP_FILE_MAX_BYTES, ['.docx', '.pdf'], 'procedure.pdf', '.docx or PDF, up to 10 MB', '10 MB'],
  ['New SOP version', sopWorkflowEn.dialogs.fileField, SOP_FILE_MAX_BYTES, ['.docx', '.pdf'], 'procedure.pdf', '.docx or PDF, up to 10 MB', '10 MB'],
  ['Add GVP Version', adminEn.regulationForm.file, GUIDELINE_FILE_MAX_BYTES, ['.pdf'], 'gvp.pdf', 'PDF, up to 20 MB', '20 MB'],
  // RegulationFormPage: adding the PDF to a version that has none uses its own hint.
  ['Add the PDF to a GVP version', { ...adminEn.regulationForm.file, hint: adminEn.regulationForm.attachHint }, GUIDELINE_FILE_MAX_BYTES, ['.pdf'], 'gvp.pdf',
    "Add the PDF for this version (PDF, up to 20 MB). Once added, it can't be replaced.", '20 MB'],
] as const)('%s: the file size limit, checked when the file is chosen (before any upload)', (_, text, max, extensions, name, hint, label) => {
  const open = () => zone(max, text, [...extensions])
  it('shows the maximum size under the drop area, from the shared limit', () => {
    expect(open().labelled()).toContain(hint)
  })
  it('accepts a file below the limit', () => {
    const { onChange, choose } = open()
    choose(sized(name, max - 1))
    expect(onChange).toHaveBeenCalledOnce()
  })
  it('accepts a file exactly at the limit', () => {
    const { onChange, choose, refusals } = open()
    choose(sized(name, max))
    expect(onChange).toHaveBeenCalledOnce()
    expect(refusals()).toEqual([])
  })
  it('refuses a much larger file, saying its size and the maximum', () => {
    const { onChange, choose, refusals } = open()
    choose(sized(name, max + 8 * MB))
    expect(onChange).not.toHaveBeenCalled()
    expect(refusals()).toEqual([`This file is ${formatFileSize(max + 8 * MB)}. The maximum size is ${label}.`])
  })
  it('refuses a file just over the limit, never saying it is as large as the limit', () => {
    const { onChange, choose, refusals } = open()
    choose(sized(name, max + 1))
    expect(onChange).not.toHaveBeenCalled()
    expect(refusals()).toEqual([`This file is ${(max / MB).toFixed(2)} MB. The maximum size is ${label}.`])
    choose(sized(name, Math.round(max + 0.04 * MB)))
    expect(refusals()).toEqual([`This file is ${(max / MB + 0.04).toFixed(2)} MB. The maximum size is ${label}.`])
  })
})

describe('the size limits and messages', () => {
  it('say the file size and the maximum, e.g. "This file is 18 MB. The maximum size is 10 MB."', () => {
    const { choose, refusals } = zone(SOP_FILE_MAX_BYTES)
    choose(sized('procedure.pdf', 18 * MB))
    expect(refusals()).toEqual(['This file is 18 MB. The maximum size is 10 MB.'])
  })
  it('match the Storage buckets exactly, in bytes', () => {
    expect(SOP_FILE_MAX_BYTES).toBe(10485760)
    expect(GUIDELINE_FILE_MAX_BYTES).toBe(20971520)
  })
  it('names the limit when the database refuses a GVP PDF as too large (not "check your connection")', () => {
    expect(adminEn.regulationForm.errors.fileTooLarge.replace('{max}', formatFileSize(GUIDELINE_FILE_MAX_BYTES)))
      .toBe('The file is too large. Files must be 20 MB or smaller.')
    expect(formatFileSize(SOP_FILE_MAX_BYTES)).toBe('10 MB')
  })
})
