import { describe, expect, it } from 'vitest'
import { detailsTable, validateForm, type RequestForm } from '../../../supabase/functions/access-requests/form.ts'
import formSource from '../../../supabase/functions/access-requests/form.ts?raw'
import singleFileSource from '../../../supabase/functions/access-requests/access-requests-single-file.ts?raw'

const valid = { organization: ' Riyadh Pharma ', contactName: ' Lama Alotaibi ', email: ' Lama@RiyadhPharma.example ', phone: '0512345678', approxUsers: 20, message: '' }

describe('the access-requests Edge Function: Request Hawkim without Position', () => {
  it('accepts a request with no position, stored as empty', () => {
    expect(validateForm(valid)).toEqual({ form: {
      organization: 'Riyadh Pharma', contactName: 'Lama Alotaibi', jobTitle: '', email: 'lama@riyadhpharma.example', phone: '+966512345678', approxUsers: 20, message: '',
    } })
  })

  it('still checks a position sent by an older form (at most 100 characters), trimmed', () => {
    expect(validateForm({ ...valid, jobTitle: ' QPPV ' })).toMatchObject({ form: { jobTitle: 'QPPV' } })
    expect(validateForm({ ...valid, jobTitle: 'x'.repeat(101) })).toEqual({ invalid: ['jobTitle'] })
  })

  it('still requires everything else', () => {
    expect(validateForm({})).toEqual({ invalid: ['organization', 'contactName', 'email', 'phone', 'approxUsers'] })
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

describe('the single-file copy of the function (pasted in the dashboard)', () => {
  /** A function's source, from its declaration to its closing brace at the start of a line. */
  const source = (file: string, name: string) => {
    const text = file.replace(/\r\n/g, '\n')
    const start = text.indexOf(`export function ${name}(`)
    return text.slice(start, text.indexOf('\n}\n', start) + 2)
  }

  it.each(['validateForm', 'detailsTable', 'normalizePhone'])('has the same %s as form.ts', (name) => {
    expect(source(formSource, name).length).toBeGreaterThan(50)
    expect(source(singleFileSource, name)).toBe(source(formSource, name))
  })
})
