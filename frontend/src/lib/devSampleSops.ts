/*
 * DEVELOPMENT ONLY: sample SOPs to try pagination without real data. Opening My SOPs or the SOP
 * Directory with ?devSops=40 adds 40 of them to that list in this tab (nothing is saved).
 * Both pages call this only inside `if (import.meta.env.DEV)`, which Vite replaces with false
 * in the production build, so this module and its text are left out of it.
 */
import { devSamplesEn } from '../content/devSamples.en'
import type { Sop } from '../data/mock/types'
import type { SopStatus } from '../types/status'

/** The most sample SOPs a URL can ask for. */
const MAX_SAMPLES = 500
/** Spread over the My SOPs tabs (New SOPs, In Progress, Completed); the directory shows only the published ones. */
const STATUSES: SopStatus[] = ['draft', 'in-review', 'published', 'returned', 'in-approval', 'approved']

/** How many sample SOPs the URL asks for (?devSops=40), or 0. */
export function devSampleCount(params: URLSearchParams): number {
  const value = Number(params.get('devSops'))
  return Number.isInteger(value) && value > 0 ? Math.min(value, MAX_SAMPLES) : 0
}

/**
 * `count` sample SOPs by this author in this department, with different dates, statuses and file
 * types. `directory`: all published, so every sample shows in the SOP Directory.
 */
export function devSampleSops(count: number, authorId: string, departmentId: string, directory = false): Sop[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1
    const day = new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString().slice(0, 10)
    const fileType = n % 3 === 0 ? 'docx' : 'pdf'
    return {
      id: `dev-sample-${departmentId}-${n}`, code: `DEV-${String(n).padStart(3, '0')}`, title: devSamplesEn.title.replace('{n}', String(n)),
      authorId, coAuthorIds: [], departmentId, status: directory ? 'published' : STATUSES[index % STATUSES.length], version: '1',
      lastUpdated: day, fileName: `sample-${n}.${fileType}`, fileType, versions: [], reviewers: [], approvers: [], timeline: [], comments: [], complianceChecks: [],
    }
  })
}
