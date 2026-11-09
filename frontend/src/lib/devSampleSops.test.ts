import { describe, expect, it } from 'vitest'
import { devSampleCount, devSampleSops } from './devSampleSops'

describe('development-only sample SOPs', () => {
  it('reads how many the URL asks for, up to 500', () => {
    expect(devSampleCount(new URLSearchParams('devSops=40'))).toBe(40)
    expect(devSampleCount(new URLSearchParams('devSops=9999'))).toBe(500)
    for (const value of ['', 'abc', '0', '-3', '2.5']) expect(devSampleCount(new URLSearchParams(`devSops=${value}`))).toBe(0)
    expect(devSampleCount(new URLSearchParams(''))).toBe(0)
  })

  it('makes SOPs by this author in this department, spread over the My SOPs tabs', () => {
    const samples = devSampleSops(12, 'me', 'home')
    expect(new Set(samples.map((sop) => sop.id)).size).toBe(12)
    expect(samples.every((sop) => sop.authorId === 'me' && sop.departmentId === 'home')).toBe(true)
    expect(new Set(samples.map((sop) => sop.status))).toEqual(new Set(['draft', 'in-review', 'published', 'returned', 'in-approval', 'approved']))
    expect(samples[0].title).toBe('Sample SOP 1')
    expect(devSampleSops(5, 'me', 'home', true).every((sop) => sop.status === 'published')).toBe(true)
  })
})
