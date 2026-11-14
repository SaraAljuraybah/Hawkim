import { describe, expect, it } from 'vitest'
import { detailsTable, validateForm, type RequestForm } from '../../../supabase/functions/access-requests/form.ts'
import formSource from '../../../supabase/functions/access-requests/form.ts?raw'
import singleFileSource from '../../../supabase/functions/access-requests/access-requests-single-file.ts?raw'
import indexSource from '../../../supabase/functions/access-requests/index.ts?raw'

const valid = {
  organization: ' Riyadh Pharma ', contactName: ' Lama Alotaibi ', email: ' Lama@RiyadhPharma.example ', phone: '0512345678', approxUsers: 20, message: '',
  organizationEmail: ' info@riyadhpharma.example ', organizationAddress: ' King Fahd Road, Riyadh ', organizationMapsUrl: '',
  organizationWebsite: '', organizationDescription: ' Makes medicines. ',
}

describe('the access-requests Edge Function: Request Hawkim without Position', () => {
  it('accepts a request with no position, stored as empty', () => {
    expect(validateForm(valid)).toEqual({ form: {
      organization: 'Riyadh Pharma', contactName: 'Lama Alotaibi', jobTitle: '', email: 'lama@riyadhpharma.example', phone: '+966512345678', approxUsers: 20, message: '',
      organizationEmail: 'info@riyadhpharma.example', organizationAddress: 'King Fahd Road, Riyadh', organizationMapsUrl: '',
      organizationWebsite: '', organizationDescription: 'Makes medicines.',
    } })
  })

  it('still checks a position sent by an older form (at most 100 characters), trimmed', () => {
    expect(validateForm({ ...valid, jobTitle: ' QPPV ' })).toMatchObject({ form: { jobTitle: 'QPPV' } })
    expect(validateForm({ ...valid, jobTitle: 'x'.repeat(101) })).toEqual({ invalid: ['jobTitle'] })
  })

  it('still requires everything else, and the organization email, an address or Google Maps link, and a description', () => {
    expect(validateForm({})).toEqual({ invalid: [
      'organization', 'contactName', 'email', 'phone', 'organizationEmail', 'organizationAddress', 'organizationDescription', 'approxUsers',
    ] })
  })

  it('shows no Position row in the review email without a position, and the position when there is one', () => {
    const form = (validateForm(valid) as { form: RequestForm }).form
    const html = detailsTable(form)
    expect(html).not.toContain('>Position<')
    expect(html).toContain('>Organization<')
    expect(html).toContain('>Contact person<')
    expect(detailsTable({ ...form, jobTitle: 'QPPV' })).toContain('>Position</td><td style="padding:6px 0;color:#2A1B20;">QPPV<')
  })
})

describe('the access-requests Edge Function: the organization’s details', () => {
  const invalid = (values: Record<string, unknown>) => {
    const result = validateForm({ ...valid, ...values })
    return 'invalid' in result ? result.invalid : []
  }

  it('takes the Organization Profile’s rules', () => {
    expect(invalid({ organizationEmail: 'info@' })).toEqual(['organizationEmail'])
    expect(invalid({ organizationEmail: `${'e'.repeat(250)}@x.io` })).toEqual(['organizationEmail'])
    expect(invalid({ organizationAddress: 'a'.repeat(301) })).toEqual(['organizationAddress'])
    expect(invalid({ organizationAddress: 'Line one\nline two' })).toEqual(['organizationAddress'])
    expect(invalid({ organizationDescription: 'd'.repeat(1001) })).toEqual(['organizationDescription'])
    expect(invalid({ organizationMapsUrl: `https://${'m'.repeat(2040)}.com` })).toEqual(['organizationMapsUrl'])
    expect(invalid({ organizationWebsite: 'https://riyadh pharma.example' })).toEqual(['organizationWebsite'])
  })

  it('needs an address or a Google Maps link (one is enough), and no website', () => {
    expect(invalid({ organizationAddress: '', organizationMapsUrl: '' })).toEqual(['organizationAddress'])
    expect(invalid({ organizationAddress: '', organizationMapsUrl: 'https://maps.google.com/?q=riyadh' })).toEqual([])
    expect(invalid({ organizationWebsite: '' })).toEqual([])
  })

  it('takes https:// links only', () => {
    expect(invalid({ organizationMapsUrl: 'http://maps.google.com/?q=riyadh' })).toEqual(['organizationMapsUrl'])
    expect(invalid({ organizationWebsite: 'http://riyadhpharma.example' })).toEqual(['organizationWebsite'])
    expect(invalid({ organizationWebsite: 'riyadhpharma.example' })).toEqual(['organizationWebsite'])
    expect(invalid({ organizationWebsite: 'https://riyadhpharma.example', organizationMapsUrl: 'HTTPS://maps.google.com/?q=r' })).toEqual([])
  })

  it('keeps the real Website apart from the hidden field for bots (`website`)', () => {
    expect(invalid({ website: 'not checked here' })).toEqual([])
    expect((validateForm({ ...valid, website: 'https://bot.example' }) as { form: RequestForm }).form.organizationWebsite).toBe('')
    expect(indexSource).toContain('if (typeof input.website === "string" && input.website.trim()) return json(200, { ok: true })')
    expect(indexSource).toContain('p_organization_website: f.organizationWebsite')
  })

  it('lists them in the team’s email, with the contact person’s email named as such', () => {
    const form = (validateForm({ ...valid, organizationWebsite: 'https://riyadhpharma.example' }) as { form: RequestForm }).form
    const html = detailsTable(form)
    const labels = [...html.matchAll(/vertical-align:top;">([^<]+)</g)].map((match) => match[1])
    expect(labels).toEqual([
      'Organization', 'Contact person', 'Contact person email', 'Phone', 'Organization email', 'Address', 'Google Maps link',
      'Website', 'Description', 'Approximate number of users', 'Message',
    ])
    expect(html).toContain('>https://riyadhpharma.example<')
    // A Google Maps link not given: a dash.
    expect(html).toContain('>Google Maps link</td><td style="padding:6px 0;color:#2A1B20;">—<')
  })
})

describe('the single-file copy of the function (pasted in the dashboard)', () => {
  /** A function's source, from its declaration to its closing brace at the start of a line. */
  const source = (file: string, name: string) => {
    const text = file.replace(/\r\n/g, '\n')
    const start = text.indexOf(`export function ${name}(`)
    return text.slice(start, text.indexOf('\n}\n', start) + 2)
  }
  /** A declaration's text, up to the end of its line or block. */
  const declaration = (file: string, start: string, end: string) => {
    const text = file.replace(/\r\n/g, '\n')
    const from = text.indexOf(start)
    return text.slice(from, text.indexOf(end, from) + end.length)
  }

  it.each(['validateForm', 'detailsTable', 'normalizePhone'])('has the same %s as form.ts', (name) => {
    expect(source(formSource, name).length).toBeGreaterThan(50)
    expect(source(singleFileSource, name)).toBe(source(formSource, name))
  })

  it('has the same RequestForm and https:// link rule as form.ts', () => {
    expect(declaration(singleFileSource, 'export type RequestForm', '\n}\n')).toBe(declaration(formSource, 'export type RequestForm', '\n}\n'))
    expect(declaration(singleFileSource, 'const HTTPS_LINK', '\n')).toBe(declaration(formSource, 'export const HTTPS_LINK', '\n').replace('export ', ''))
  })

  it('sends and returns the organization’s details like index.ts', () => {
    for (const line of [
      'p_organization_description: f.organizationDescription,',
      'if (e instanceof DbError && e.message === "invalid_organization_details") return fail(400, "invalid")',
      'organizationDescription: r.organization_description,',
    ]) {
      expect(indexSource).toContain(line)
      expect(singleFileSource).toContain(line)
    }
  })
})
