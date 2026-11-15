import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { organizationRows } from '../../lib/organization'
import type { OrganizationHierarchy } from '../../services/organization'
import { DivisionPreview } from '../admin/DivisionPreview'
import { OrganizationTable } from './OrganizationTable'

/* Organizational Structure: a division's name opens its details (the Divisions and Departments preview). */

// The table's state, kept between calls, so a click can be followed by the next render.
const host = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }))
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useState: (initial: unknown) => {
  const index = host.index++
  if (!(index in host.states)) host.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
  return [host.states[index], (value: unknown) => {
    host.states[index] = typeof value === 'function' ? (value as (previous: unknown) => unknown)(host.states[index]) : value
  }]
}, useRef: (initial: unknown) => {
  const index = host.refIndex++
  if (!(index in host.refs)) host.refs[index] = { current: initial }
  return host.refs[index]
} }))
beforeEach(() => { host.states = []; host.index = 0; host.refs = []; host.refIndex = 0 })

const hierarchy: OrganizationHierarchy = {
  organization: null,
  divisions: [
    { id: 'ops', name: 'Operations', email: 'ops@test.invalid', description: 'Runs the sites.' },
    { id: 'rnd', name: 'R and D', email: null, description: null },
  ],
  departments: [{ id: 'qa', name: 'Quality', divisionId: 'ops', email: null, employees: [] }],
}
const filters = { query: '', divisions: [], departments: [], roles: [] }

type Element = ReactElement<Record<string, unknown>>
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function render() {
  host.index = 0
  host.refIndex = 0
  return elements(OrganizationTable({ rows: organizationRows(hierarchy, filters), filtering: false, filterKey: '[]' }))
}
const button = (tree: Element[], label: string) => tree.find((item) => item.type === 'button' && item.props['aria-label'] === label)!
const preview = (tree: Element[]) => tree.find((item) => item.type === DivisionPreview)

describe('the division name on Organizational Structure', () => {
  it('opens the division’s details with its name, description and email, without expanding it', () => {
    expect(preview(render())).toBeUndefined()
    const name = button(render(), 'View Operations details')
    ;(name.props.onClick as (event: unknown) => void)({ currentTarget: { focus: vi.fn() } })
    const tree = render()
    expect(preview(tree)?.props.division).toEqual({ name: 'Operations', description: 'Runs the sites.', email: 'ops@test.invalid' })
    // Expanding is the arrow's job: still closed.
    expect(button(tree, 'Show departments in Operations').props['aria-expanded']).toBe(false)
  })

  it('closes from the dialog and gives focus back to the name', () => {
    const focus = vi.fn()
    ;(button(render(), 'View Operations details').props.onClick as (event: unknown) => void)({ currentTarget: { focus } })
    ;(preview(render())!.props.onClose as () => void)()
    expect(preview(render())).toBeUndefined()
    expect(focus).toHaveBeenCalledOnce()
  })

  it('still expands and collapses with the arrow, without opening the details', () => {
    ;(button(render(), 'Show departments in Operations').props.onClick as () => void)()
    const tree = render()
    expect(button(tree, 'Show departments in Operations').props['aria-expanded']).toBe(true)
    expect(preview(tree)).toBeUndefined()
  })

  it('shows the details read-only, with bold Description and Email labels, and Close', () => {
    const html = renderToStaticMarkup(<DivisionPreview division={{ name: 'Operations', description: 'Runs the sites.', email: 'ops@test.invalid' }} onClose={vi.fn()} />)
    expect(html).toMatch(/<h2[^>]*>Operations<\/h2>/)
    expect(html).toContain('<dt class="font-bold text-maroon">Description</dt><dd class="mt-1 break-words text-black">Runs the sites.</dd>')
    expect(html).toContain('<dt class="font-bold text-maroon">Email</dt>')
    expect(html).toContain('>ops@test.invalid<')
    expect(html).toMatch(/>Close<\/button>/)
    for (const label of ['Edit', 'Delete', 'Save']) expect(html).not.toMatch(new RegExp(`>${label}[^<]*</button>`))
  })

  it('says what a division without a description or email doesn’t have', () => {
    const html = renderToStaticMarkup(<DivisionPreview division={{ name: 'R and D', description: null, email: null }} onClose={vi.fn()} />)
    expect(html).toContain('>Not provided.<')
    expect(html).toContain('>No email recorded.<')
  })
})
