import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Sop, User } from '../data/mock/types'
import { CheckAlreadyCompletedError, SAMPLE_CHECK_DURATION_MS, SERVICE_CHECK_POLL_MS } from '../lib/compliance'
import { fetchSop } from '../services/sops'
import { SopsProvider } from './SopsProvider'
import { useSops, type SopsStore } from './sopsContext'


const { sara, own } = vi.hoisted(() => {
  const sara: User = { id: 'uuid-sara', name: 'Sara', email: 'sara@hawkim.test', initials: 'SA', departmentId: 'it', permissions: ['author'] }
  const own: Sop = {
    id: 'uuid-sop', code: 'SOP-001', title: 'Backup', departmentId: 'it', authorId: 'uuid-sara', coAuthorIds: [], status: 'draft', version: '1',
    lastUpdated: '2026-10-26', fileName: 'Backup.pdf', fileType: 'pdf', reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [],
    versions: [{ version: '1', fileName: 'Backup.pdf', fileType: 'pdf', uploadedById: 'uuid-sara', uploadedAt: '2026-10-26T09:00:00Z', storagePath: 'uuid-sara/a.pdf' }],
  }
  return { sara, own }
})
const service = vi.hoisted(() => ({ start: vi.fn(), finish: vi.fn() }))
vi.mock('../data/mock/sops', () => ({ sops: [own] }))
vi.mock('./sessionContext', () => ({ useSession: () => ({ user: sara }) }))
vi.mock('./usersContext', () => ({ useUsers: () => ({ users: [sara], getUser: () => sara }) }))
vi.mock('./departmentsContext', () => ({ useDepartments: () => ({ departments: [{ id: 'it', name: 'IT', initials: 'IT', description: '', requiresComplianceCheck: true }] }) }))
vi.mock('./guidelinesContext', () => ({ useGuidelines: () => ({ currentGuideline: { name: 'GVP', version: '4.0' } }) }))
vi.mock('../services/compliance', () => ({ startComplianceCheck: service.start, finishSampleCheck: service.finish }))
vi.mock('../services/sops', () => ({ fetchSops: vi.fn(async () => []), fetchSop: vi.fn(async () => own) }))

function store(): SopsStore {
  const observe = vi.fn<(value: SopsStore) => void>()
  function Capture() { observe(useSops()); return null }
  renderToStaticMarkup(<SopsProvider><Capture /></SopsProvider>)
  return observe.mock.calls.at(-1)![0]
}

beforeEach(() => {
  vi.useFakeTimers()
  // The store's timers use window; the tests run without a browser.
  vi.stubGlobal('window', globalThis)
  service.start.mockReset().mockResolvedValue('uuid-check')
  service.finish.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('running a compliance check', () => {
  it('starts it in the database and finishes the sample check a moment later', async () => {
    const sops = store()
    await sops.runCheck('uuid-sop')
    expect(service.start).toHaveBeenCalledWith('uuid-sop')
    expect(service.finish).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(SAMPLE_CHECK_DURATION_MS)
    expect(service.finish).toHaveBeenCalledWith('uuid-check', 'completed')
  })

  it('fails the next check when the demo switch is on, then turns the switch off', async () => {
    const sops = store()
    sops.setFailNextCheck(true)
    await sops.runCheck('uuid-sop')
    await vi.advanceTimersByTimeAsync(SAMPLE_CHECK_DURATION_MS)
    expect(service.finish).toHaveBeenLastCalledWith('uuid-check', 'failed')
    await sops.runCheck('uuid-sop')
    await vi.advanceTimersByTimeAsync(SAMPLE_CHECK_DURATION_MS)
    expect(service.finish).toHaveBeenLastCalledWith('uuid-check', 'completed')
  })

  it('reads the SOP again when the database refuses a repeat check, and passes the refusal on', async () => {
    const sops = store()
    vi.mocked(fetchSop).mockClear()
    service.start.mockRejectedValue(new CheckAlreadyCompletedError('Already completed'))
    await expect(sops.runCheck('uuid-sop')).rejects.toBeInstanceOf(CheckAlreadyCompletedError)
    expect(fetchSop).toHaveBeenCalledWith('uuid-sop')
    await vi.advanceTimersByTimeAsync(SAMPLE_CHECK_DURATION_MS)
    expect(service.finish).not.toHaveBeenCalled()
  })

  it('still reports the refusal if reading the SOP again fails', async () => {
    const sops = store()
    vi.mocked(fetchSop).mockRejectedValueOnce(new Error('Offline'))
    service.start.mockRejectedValue(new CheckAlreadyCompletedError('Already completed'))
    await expect(sops.runCheck('uuid-sop')).rejects.toBeInstanceOf(CheckAlreadyCompletedError)
  })

  it('does not read the SOP again after any other failure to start', async () => {
    const sops = store()
    vi.mocked(fetchSop).mockClear()
    service.start.mockRejectedValue(new Error('Connection lost'))
    await expect(sops.runCheck('uuid-sop')).rejects.toThrow('Connection lost')
    expect(fetchSop).not.toHaveBeenCalled()
  })

  it('refuses a check the person may not run, without asking the database', async () => {
    const sops = store()
    await expect(sops.runCheck('unknown')).rejects.toThrow()
    expect(service.start).not.toHaveBeenCalled()
  })

  it('leaves a check of the compliance service to the service and reads the SOP again until it ends', async () => {
    const check = { id: 'uuid-check', sopId: 'uuid-sop', version: '1', engine: 'hawkim', triggeredById: 'uuid-sara', guideline: { name: 'GVP', version: '4.0' }, findings: [] }
    const running: Sop = { ...own, complianceChecks: [{ ...check, status: 'running', startedAt: '2026-11-02T09:05:00Z' }] }
    const done: Sop = { ...own, complianceChecks: [{ ...check, status: 'completed', startedAt: '2026-11-02T09:05:00Z', completedAt: '2026-11-02T09:20:00Z' }] }
    const sops = store()
    vi.mocked(fetchSop).mockReset().mockResolvedValueOnce(running).mockResolvedValueOnce(running).mockResolvedValue(done)
    await sops.runCheck('uuid-sop')
    expect(fetchSop).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(SERVICE_CHECK_POLL_MS)
    expect(fetchSop).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(SERVICE_CHECK_POLL_MS)
    expect(fetchSop).toHaveBeenCalledTimes(3)
    // Completed: no more reading, and the browser never finishes a service check.
    await vi.advanceTimersByTimeAsync(SERVICE_CHECK_POLL_MS * 3)
    expect(fetchSop).toHaveBeenCalledTimes(3)
    expect(service.finish).not.toHaveBeenCalled()
    vi.mocked(fetchSop).mockReset().mockResolvedValue(own)
  })
})
