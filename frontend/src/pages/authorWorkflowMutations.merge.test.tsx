import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FormDialog } from '../components/ui/FormDialog'
import { PeopleList } from '../components/workflow/PeopleList'
import { SopDescription } from '../components/workflow/SopDescription'
import { VersionHistory } from '../components/workflow/VersionHistory'
import { sopWorkflowEn } from '../content/workflow.en'
import type { Sop, SopVersion, User } from '../data/mock/types'
import { SopWorkflowPage } from './SopWorkflowPage'

type Slot = { value: unknown }
type Confirmation = {
  open: boolean
  title: string
  children?: ReactNode
  onConfirm: () => boolean | void | Promise<boolean | void>
}
const fixture = vi.hoisted(() => ({
  slots: [] as Slot[], index: 0, confirmations: [] as Confirmation[], sop: null as Sop | null,
  removeCoAuthor: vi.fn<(sopId: string, userId: string) => Promise<void>>(),
  deleteVersion: vi.fn<(sopId: string, version: string) => Promise<void>>(),
  updateDescription: vi.fn<(sopId: string, text: string) => Promise<void>>(),
  users: [
    { id: 'author', name: 'Main Author', departmentId: 'home', permissions: ['author'] },
    { id: 'coauthor', name: 'Contributing Author', departmentId: 'home', permissions: ['author'] },
  ] as User[],
}))

// Keep the page's state across renders, then render only its confirmation dialogs.
// This exercises the real action callbacks without a DOM or a new test dependency.
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
  }
})
vi.mock('react-router-dom', async (original) => ({ ...await original<typeof import('react-router-dom')>(), useParams: () => ({ id: 'author-sop' }) }))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.users[0] }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ users: fixture.users, nameOf: (id?: string) => fixture.users.find((user) => user.id === id)?.name ?? '' }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [{ id: 'home', name: 'Home', requiresComplianceCheck: false }], nameOf: () => 'Home' }) }))
vi.mock('../state/guidelinesContext', () => ({ useGuidelines: () => ({ current: { version: '4.0' } }) }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: [fixture.sop], removeCoAuthor: fixture.removeCoAuthor, deleteVersion: fixture.deleteVersion, updateDescription: fixture.updateDescription }) }))
vi.mock('../components/ui/FormDialog', () => ({ FormDialog: (props: Confirmation) => {
  fixture.confirmations.push(props)
  return props.open ? <section role="dialog" aria-label={props.title}>{props.children}</section> : null
} }))

function elements(node: ReactNode): ReactElement<{ children?: ReactNode }>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node, ...elements(node.props.children)]
}
function element<P>(tree: ReactNode, type: unknown): ReactElement<P> {
  const found = elements(tree).find((node) => node.type === type)
  if (!found) throw new Error('Expected author workflow control')
  return found as ReactElement<P>
}
function render() {
  fixture.index = 0
  fixture.confirmations = []
  const page = SopWorkflowPage()
  const html = renderToStaticMarkup(<>{elements(page).filter((node) => node.type === FormDialog)}</>)
  return { page, html, confirmations: [...fixture.confirmations] }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((accept) => { resolve = accept })
  return { promise, resolve }
}

const operations = [
  {
    name: 'remove co-author', mutation: () => fixture.removeCoAuthor,
    open: (page: ReactNode) => element<{ onRemoveCoAuthor: (userId: string, trigger: HTMLElement) => void }>(page, PeopleList).props.onRemoveCoAuthor('coauthor', {} as HTMLElement),
    arguments: ['author-sop', 'coauthor'],
    title: sopWorkflowEn.dialogs.removeCoAuthor.title,
    error: sopWorkflowEn.messages.coAuthorRemoveFailed.replace('{name}', 'Contributing Author'),
  },
  {
    name: 'delete version', mutation: () => fixture.deleteVersion,
    open: (page: ReactNode) => element<{ onDelete: (version: SopVersion, trigger: HTMLElement) => void }>(page, VersionHistory).props.onDelete(fixture.sop!.versions[1], {} as HTMLElement),
    arguments: ['author-sop', '2'],
    title: sopWorkflowEn.dialogs.deleteVersion.title.replace('{version}', '2'),
    error: sopWorkflowEn.messages.deleteFailed.replace('{version}', '2'),
  },
]

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('requestAnimationFrame', vi.fn())
  fixture.slots = []
  fixture.index = 0
  fixture.confirmations = []
  fixture.removeCoAuthor.mockReset()
  fixture.deleteVersion.mockReset()
  fixture.updateDescription.mockReset()
  fixture.sop = {
    id: 'author-sop', code: 'SOP-001', title: 'Author mutations', departmentId: 'home', authorId: 'author', coAuthorIds: ['coauthor'],
    status: 'draft', version: '2', lastUpdated: '2026-10-29', fileName: 'current.pdf', fileType: 'pdf',
    versions: [
      { version: '1', fileName: 'first.pdf', fileType: 'pdf', uploadedAt: '2026-10-28T09:00:00Z', uploadedById: 'author' },
      { version: '2', fileName: 'current.pdf', fileType: 'pdf', uploadedAt: '2026-10-29T09:00:00Z', uploadedById: 'author' },
    ], reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [],
  }
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('author workflow confirmation mutations', () => {
  for (const operation of operations) {
    it(`awaits ${operation.name} once and closes only after it succeeds`, async () => {
      const pending = deferred()
      operation.mutation().mockReturnValue(pending.promise)
      operation.open(render().page)
      const confirmation = render().confirmations.find((item) => item.open && item.title === operation.title)!
      expect(confirmation).toBeDefined()
      const saving = confirmation.onConfirm()
      expect(operation.mutation()).toHaveBeenCalledExactlyOnceWith(...operation.arguments)
      expect(render().confirmations.find((item) => item.title === operation.title)?.open).toBe(true)

      pending.resolve()
      await saving
      expect(operation.mutation()).toHaveBeenCalledExactlyOnceWith(...operation.arguments)
      expect(render().confirmations.every((item) => !item.open)).toBe(true)
    })

    it(`keeps ${operation.name} open and exposes its error after an asynchronous failure`, async () => {
      operation.mutation().mockRejectedValue(new Error('Mutation rejected'))
      operation.open(render().page)
      const confirmation = render().confirmations.find((item) => item.open && item.title === operation.title)!
      expect(await confirmation.onConfirm()).toBe(false)

      const failed = render()
      expect(operation.mutation()).toHaveBeenCalledExactlyOnceWith(...operation.arguments)
      expect(failed.confirmations.find((item) => item.open)?.title).toBe(operation.title)
      expect(failed.html).toContain('role="alert"')
      expect(failed.html).toContain(operation.error)
    })
  }
})

describe('SOP description on the author page', () => {
  type DescriptionProps = { description?: string; onSave?: (text: string) => Promise<void>; onSaved?: () => void }
  const description = () => element<DescriptionProps>(render().page, SopDescription).props

  it('lets the main author save it through the store and announces the change', async () => {
    fixture.sop!.description = 'Current scope'
    fixture.updateDescription.mockResolvedValue()
    const props = description()
    expect(props.description).toBe('Current scope')
    await props.onSave!('New scope')
    expect(fixture.updateDescription).toHaveBeenCalledExactlyOnceWith('author-sop', 'New scope')
    props.onSaved!()
    vi.runAllTimers()
    const status = elements(render().page).find((node) => (node.props as { role?: string }).role === 'status')!
    expect(renderToStaticMarkup(status)).toContain(sopWorkflowEn.messages.descriptionUpdated)
  })

  it('is editable at any status before publishing, and read-only for co-authors and once published', () => {
    fixture.sop!.status = 'in-review'
    expect(description().onSave).toBeDefined()
    fixture.sop!.status = 'published'
    expect(description().onSave).toBeUndefined()
    fixture.sop!.status = 'draft'
    fixture.users.reverse()
    try {
      expect(description().onSave).toBeUndefined()
    } finally {
      fixture.users.reverse()
    }
  })
})
