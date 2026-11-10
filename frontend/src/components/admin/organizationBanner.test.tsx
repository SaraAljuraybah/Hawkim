import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OrganizationBanner, OrganizationNameForm } from './OrganizationBanner'
import { fetchOrganizationName, organizationNameProblem, saveOrganizationName } from '../../services/organizationSettings'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../services/supabase', () => ({ supabase: () => ({ rpc }) }))

const banner = (name: string | null, canEdit: boolean) => renderToStaticMarkup(<OrganizationBanner name={name} canEdit={canEdit} onEdit={vi.fn()} />)

describe('the organization banner', () => {
  it('shows the pill icon in a maroon circle, the name in maroon with a thin gold line, and no heading', () => {
    const html = banner('Riyadh Pharma', false)
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*rounded-full bg-maroon text-offwhite[^"]*"><svg[^>]*lucide-pill/)
    expect(html).toContain('<p class="text-xl font-semibold break-words text-maroon sm:text-2xl"><span class="sr-only">Organization: </span>Riyadh Pharma</p>')
    expect(html).toContain('<span aria-hidden="true" class="mt-2 block h-0.5 w-16 rounded-full bg-gold"></span>')
    expect(html).not.toMatch(/<h[1-6]/)
    // Gold is only the line: never on text.
    expect(html).not.toContain('text-gold')
    expect(html).toContain('mb-8')
  })

  it('has the pencil only for the Super Admin', () => {
    expect(banner('Riyadh Pharma', false)).not.toContain('Edit organization name')
    const editable = banner('Riyadh Pharma', true)
    expect(editable).toContain('aria-label="Edit organization name"')
    expect(editable).toContain('lucide-pencil')
  })

  it('without a name: "Organization name not set" with the pencil for the Super Admin, nothing for anyone else', () => {
    const html = banner(null, true)
    expect(html).toContain('<p class="text-base text-text-gray">Organization name not set</p>')
    expect(html).toContain('aria-label="Edit organization name"')
    expect(banner(null, false)).toBe('')
    expect(banner('', false)).toBe('')
  })
})

describe('the Edit Organization Name dialog', () => {
  it('has one required field filled in with the current name, Save Changes and Cancel', () => {
    const html = renderToStaticMarkup(<OrganizationNameForm name="Riyadh Pharma" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(html).toContain('Edit Organization Name')
    expect([...html.matchAll(/<input[^>]*name="([^"]+)"/g)].map((match) => match[1])).toEqual(['organizationName'])
    expect(html).toMatch(/<input[^>]*required=""[^>]*value="Riyadh Pharma"|<input[^>]*value="Riyadh Pharma"[^>]*required=""/)
    expect(html).toContain('>Organization Name')
    expect(html).toContain('>Save Changes<')
    expect(html).toContain('>Cancel<')
  })

  it('starts empty when no name is saved', () => {
    const html = renderToStaticMarkup(<OrganizationNameForm name={null} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(html).toMatch(/<input[^>]*name="organizationName"[^>]*value=""/)
  })

  it('needs a name of 1 to 200 characters, ignoring spaces at either end', () => {
    expect(organizationNameProblem('')).toBe('required')
    expect(organizationNameProblem('   ')).toBe('required')
    expect(organizationNameProblem('x'.repeat(201))).toBe('tooLong')
    expect(organizationNameProblem(`  ${'x'.repeat(200)}  `)).toBeUndefined()
    expect(organizationNameProblem(' Riyadh Pharma ')).toBeUndefined()
  })
})

describe('the organization name service', () => {
  beforeEach(() => rpc.mockReset())

  it('reads the name, or null when none is saved', async () => {
    rpc.mockResolvedValueOnce({ data: 'Riyadh Pharma', error: null })
    expect(await fetchOrganizationName()).toBe('Riyadh Pharma')
    expect(rpc).toHaveBeenLastCalledWith('get_organization_name')
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await fetchOrganizationName()).toBeNull()
    rpc.mockResolvedValueOnce({ data: 42, error: null })
    await expect(fetchOrganizationName()).rejects.toThrow('Check your connection and try again.')
  })

  it('saves the name and says what to do when the server refuses', async () => {
    rpc.mockResolvedValueOnce({ data: 'Riyadh Pharma', error: null })
    expect(await saveOrganizationName('Riyadh Pharma')).toBe('Riyadh Pharma')
    expect(rpc).toHaveBeenLastCalledWith('set_organization_name', { p_name: 'Riyadh Pharma' })
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    await expect(saveOrganizationName('X')).rejects.toThrow('Only the Super Admin can change the organization name. Refresh the page.')
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023' } })
    await expect(saveOrganizationName('X')).rejects.toThrow('Enter a name of 1 to 200 characters.')
    rpc.mockResolvedValueOnce({ data: null, error: { code: '08006' } })
    await expect(saveOrganizationName('X')).rejects.toThrow('Check your connection and try again.')
  })
})
