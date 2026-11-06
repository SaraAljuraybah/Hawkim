import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { mySopsEn } from '../../content/mySops.en'
import type { Sop } from '../../data/mock/types'
import { deleteErrorText, SopDeleteError } from '../../lib/mySops'
import type { SopStatus } from '../../types/status'
import { AuthoredSopGrid } from './AuthoredSopGrid'
import { AuthoredSopList } from './AuthoredSopList'
import { DeleteSopDialog } from './DeleteSopDialog'

// The dialog's text fields start empty; a test can give the justification a value (the first '' state).
const state = vi.hoisted(() => ({ strings: [] as string[], dialog: null as null | { onConfirm: () => unknown; [key: string]: unknown } }))
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>()
  return { ...react, useState: (initial: unknown) => (initial === '' ? [state.strings.shift() ?? '', () => {}] : react.useState(initial)) }
})
// Keeps the FormDialog's props, so the dialog's confirm can be called as the form would.
vi.mock('../ui/FormDialog', async (original) => {
  const actual = await original<typeof import('../ui/FormDialog')>()
  return {
    FormDialog: (props: Parameters<typeof actual.FormDialog>[0]) => {
      state.dialog = props as never
      return actual.FormDialog(props)
    },
  }
})
vi.mock('../../state/guidelinesContext', () => ({ useGuidelines: () => ({ current: { version: '4.0' } }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [] }) }))
beforeEach(() => { state.strings = []; state.dialog = null })

const sop = (id: string, status: SopStatus, authorId = 'me'): Sop => ({
  id, code: 'SOP-001', title: `${id} procedure`, authorId, coAuthorIds: authorId === 'me' ? [] : ['me'], departmentId: 'home', status, version: '1',
  lastUpdated: '2026-10-29', fileName: 'a.pdf', fileType: 'pdf', versions: [], reviewers: [], approvers: [], timeline: [], comments: [], complianceChecks: [],
})
const deletable = (['draft', 'in-review', 'returned', 'in-approval'] as const).map((status) => sop(status, status))
const notDeletable = [sop('approved', 'approved'), sop('published', 'published'), sop('co-authored', 'draft', 'other')]
const views = {
  grid: (sops: Sop[], onDelete = vi.fn()) => <AuthoredSopGrid sops={sops} content={mySopsEn} userId="me" onDelete={onDelete} />,
  list: (sops: Sop[], onDelete = vi.fn()) => <AuthoredSopList sops={sops} content={mySopsEn} userId="me" onDelete={onDelete} />,
}
const html = (element: ReactElement) => renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>)
const deleteButtons = (markup: string) => [...markup.matchAll(/aria-label="Delete ([^"]+) procedure"/g)].map((match) => match[1])

/** The rendered element tree (function components called), to press a button's onClick without a DOM. */
function findByLabel(node: ReactNode, label: string): ReactElement<{ onClick: (event: unknown) => void }> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByLabel(child, label)
      if (found) return found
    }
    return undefined
  }
  if (!isValidElement(node)) return undefined
  const props = node.props as { label?: string; children?: ReactNode }
  if (props.label === label) return node as ReactElement<{ onClick: (event: unknown) => void }>
  if (typeof node.type === 'function' && node.type.name !== 'IconButton' && node.type.name !== 'Link') {
    return findByLabel((node.type as (p: unknown) => ReactNode)(node.props), label)
  }
  return findByLabel(props.children, label)
}

describe.each(['grid', 'list'] as const)('the Delete button in the %s view', (view) => {
  it('is shown only to the main author, in New SOPs and In Progress', () => {
    const markup = html(views[view]([...deletable, ...notDeletable]))
    expect(deleteButtons(markup)).toEqual(['draft', 'in-review', 'returned', 'in-approval'])
  })

  it('is a danger icon button named after the SOP, without a hover tooltip', () => {
    const markup = html(views[view]([deletable[0]]))
    const button = markup.match(/<button[^>]*aria-label="Delete draft procedure"[^>]*>/)![0]
    expect(button).toContain('type="button"')
    expect(button).toContain('text-status-rejected-fg')
    expect(markup).toContain('lucide-trash-2')
    expect(markup).not.toContain('role="tooltip"')
  })

  it('sits above the stretched link, outside it, so it never opens the SOP', () => {
    const markup = html(views[view]([deletable[0]]))
    // The button is a sibling of the link, never inside it (no button nested in a link).
    const link = markup.match(/<a [^>]*href="\/my-sops\/draft"[^>]*>.*?<\/a>/)![0]
    expect(link).not.toContain('<button')
    expect(link).toContain('after:absolute after:inset-0')
    expect(markup).toMatch(/<span class="relative z-10"><span class="relative inline-flex"><button[^>]*aria-label="Delete draft procedure"/)
  })

  it('asks the page to delete that SOP, with the button to return focus to', () => {
    const onDelete = vi.fn()
    const button = findByLabel(views[view](deletable, onDelete), 'Delete returned procedure')!
    const trigger = { focus: vi.fn() }
    button.props.onClick({ currentTarget: trigger })
    expect(onDelete).toHaveBeenCalledWith(deletable[2], trigger)
  })

  it('is left out where nothing may be deleted, and when the page offers no delete', () => {
    expect(deleteButtons(html(views[view](notDeletable)))).toEqual([])
    const element = view === 'grid'
      ? <AuthoredSopGrid sops={deletable} content={mySopsEn} userId="me" />
      : <AuthoredSopList sops={deletable} content={mySopsEn} userId="me" />
    expect(deleteButtons(html(element))).toEqual([])
  })
})

describe('the list view columns', () => {
  it('adds the Delete column only when a row has the button', () => {
    expect(html(views.list([...deletable, notDeletable[0]]))).toContain('sm:grid-cols-[13rem_5.5rem_6.5rem_2.25rem]')
    const without = html(views.list(notDeletable))
    expect(without).toContain('sm:grid-cols-[13rem_5.5rem_6.5rem]')
    expect(without).not.toContain('2.25rem]')
  })
})

describe('the Delete SOP dialog', () => {
  const dialog = (onConfirm = vi.fn(async () => {})) =>
    renderToStaticMarkup(<DeleteSopDialog title="Backup procedure" content={mySopsEn.deleteSop} onConfirm={onConfirm} onClose={() => {}} />)

  it('names the SOP, warns that it is permanent and asks for a required justification', () => {
    const markup = dialog()
    expect(markup).toContain('>Delete Backup procedure</h2>')
    expect(markup).toContain("all its versions and files, reviews, comments and history. This can&#x27;t be undone.")
    expect(markup).toMatch(/<label[^>]*>Justification<span aria-hidden="true" class="ml-0.5 text-status-rejected-fg">\*<\/span><\/label>/)
    const field = markup.match(/<textarea[^>]*>/)![0]
    expect(field).toContain('required=""')
    expect(field).toContain('maxLength="1000"')
  })

  it('starts on the justification and offers Cancel and a danger Delete that locks while deleting', () => {
    const markup = dialog()
    expect(markup.indexOf('<textarea')).toBeLessThan(markup.indexOf('>Cancel</button>'))
    expect(markup).toMatch(/<button type="submit"[^>]*text-status-rejected-fg[^>]*>Delete<\/button>/)
    expect(state.dialog).toMatchObject({ confirmVariant: 'danger', busyLabel: 'Deleting…', lockWhileBusy: true, cancelLabel: 'Cancel' })
  })

  it('keeps the dialog open without deleting when the justification is empty', async () => {
    const onConfirm = vi.fn(async () => {})
    state.strings = ['   ']
    dialog(onConfirm)
    expect(await state.dialog!.onConfirm()).toBe(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('deletes with the trimmed justification and closes', async () => {
    const onConfirm = vi.fn(async () => {})
    state.strings = ['  No longer needed  ']
    dialog(onConfirm)
    expect(await state.dialog!.onConfirm()).not.toBe(false)
    expect(onConfirm).toHaveBeenCalledWith('No longer needed')
  })

  it('stays open when the delete is refused', async () => {
    state.strings = ['Reason']
    dialog(vi.fn(async () => { throw new SopDeleteError('check-running', 'From the database') }))
    expect(await state.dialog!.onConfirm()).toBe(false)
  })

  it('shows the message for each refusal, and a retry message for anything else', () => {
    const text = mySopsEn.deleteSop
    expect(deleteErrorText(new SopDeleteError('check-running', ''), text))
      .toBe("This SOP can't be deleted while a compliance check is running. Try again when it finishes.")
    expect(deleteErrorText(new SopDeleteError('not-deletable', ''), text)).toBe(text.errors['not-deletable'])
    expect(deleteErrorText(new Error('Network'), text)).toBe("The SOP couldn't be deleted. Please try again.")
  })
})
