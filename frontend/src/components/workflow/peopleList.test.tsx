import { isValidElement, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { Sop } from '../../data/mock/types'
import { IconButton } from '../ui/IconButton'
import { PeopleList } from './PeopleList'

vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ nameOf: (id: string) => ({ coauthor: 'Contributing Author' })[id] ?? id }) }))

const sop = { authorId: 'author', coAuthorIds: ['coauthor'], reviewers: [], approvers: [] } as unknown as Sop
const props = { sop, content: sopWorkflowEn.people, userId: 'author', authorsOnly: true }
const label = 'Remove Contributing Author as co-author'

function iconButton(node: ReactNode): ReactElement<{ onClick: (event: MouseEvent<HTMLButtonElement>) => void }> | undefined {
  if (Array.isArray(node)) return node.map(iconButton).find(Boolean)
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined
  if (node.type === IconButton) return node as ReactElement<{ onClick: (event: MouseEvent<HTMLButtonElement>) => void }>
  return iconButton(node.props.children)
}

describe('remove co-author button', () => {
  it('is a labelled trash icon button with a tooltip and no visible text', () => {
    const html = renderToStaticMarkup(<PeopleList {...props} canManageCoAuthors onRemoveCoAuthor={() => {}} />)
    expect(html).toContain(`aria-label="${label}"`)
    expect(html).toContain('lucide-trash-2')
    expect(html).toContain('text-status-rejected-fg')
    expect(html).toMatch(new RegExp(`role="tooltip"[^>]*>.*${label}.*</span>`))
    expect(html).not.toContain('>Remove<')
  })
  it('asks for confirmation through the same handler, with the button as the trigger', () => {
    const onRemove = vi.fn()
    const list = PeopleList({ ...props, canManageCoAuthors: true, onRemoveCoAuthor: onRemove })
    const button = iconButton(list)!
    const trigger = {} as HTMLButtonElement
    button.props.onClick({ currentTarget: trigger } as MouseEvent<HTMLButtonElement>)
    expect(onRemove).toHaveBeenCalledWith('coauthor', trigger)
  })
  it('sits at the right of a full-width row, in a slot as wide as the SOP history Delete column', () => {
    const html = renderToStaticMarkup(<PeopleList {...props} canManageCoAuthors onRemoveCoAuthor={() => {}} />)
    expect(html).toMatch(/^<div class="space-y-6">/)
    expect(html).toContain('<li class="flex items-center justify-between gap-3">')
    expect(html).toContain('md:w-20 md:justify-center')
    expect(html).not.toContain(sopWorkflowEn.people.addAuthor)
  })
  it('is hidden from people who cannot manage co-authors', () => {
    const html = renderToStaticMarkup(<PeopleList {...props} canManageCoAuthors={false} onRemoveCoAuthor={() => {}} />)
    expect(html).not.toContain(label)
  })
})
