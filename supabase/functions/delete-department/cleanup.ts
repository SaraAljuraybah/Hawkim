/** Shared, testable worker. Only its caller holds the server credential. */
export interface CleanupFile { bucket: string; path: string }
export interface CleanupClaim { state: string; leaseToken?: string; files?: CleanupFile[] }
export interface CleanupDependencies {
  claim: (jobId: string) => Promise<CleanupClaim>
  remove: (bucket: string, paths: string[]) => Promise<void>
  /** Paths of this job that the database still sees in Storage (storage.objects). */
  present: (jobId: string, paths: string[]) => Promise<string[]>
  acknowledge: (jobId: string, token: string, paths: string[], failed: boolean) => Promise<string>
}

const unsafePath = (file: CleanupFile) =>
  file.bucket !== 'sop-files' || !file.path || file.path.startsWith('/') || file.path.split('/').includes('..')

/** Processes ONE claimed batch. Returns the job state: completed, pending, failed or busy. */
export async function cleanDepartmentFiles(jobId: string, dependencies: CleanupDependencies): Promise<string> {
  const claim = await dependencies.claim(jobId)
  if (claim.state === 'completed' || claim.state === 'busy') return claim.state
  if (claim.state !== 'processing' || !claim.leaseToken || !Array.isArray(claim.files)) throw new Error('Invalid cleanup claim')
  const paths = claim.files.map((file) => file.path)
  let deleted: string[] = []
  let failed = false
  if (claim.files.some(unsafePath)) {
    failed = true
  } else if (paths.length) {
    // A Storage error (permissions, network, partial batch) is not trusted either way:
    // what counts is which objects are verifiably gone afterwards.
    try { await dependencies.remove('sop-files', paths) } catch { /* verified below */ }
    try {
      const remaining = new Set(await dependencies.present(jobId, paths))
      deleted = paths.filter((path) => !remaining.has(path))
      failed = remaining.size > 0
    } catch {
      // Verification unavailable: acknowledge nothing, keep the job retryable.
      deleted = []
      failed = true
    }
  }
  // If this acknowledgement fails, the persisted lease expires and a retry re-verifies files.
  // The database re-checks Storage itself and refuses any path that is still present.
  return dependencies.acknowledge(jobId, claim.leaseToken, deleted, failed)
}

/** Runs batches until the job completes, fails, is busy elsewhere, or the time budget ends (then 'pending'). */
export async function cleanDepartmentFilesUntilDone(jobId: string, dependencies: CleanupDependencies, budgetMs = 20000, now = () => Date.now()): Promise<string> {
  const end = now() + budgetMs
  for (;;) {
    const state = await cleanDepartmentFiles(jobId, dependencies)
    if (state !== 'pending' || now() >= end) return state
  }
}

/** Test/diagnostic helper for Storage `info()` results: only an explicit NoSuchKey means absent;
 * permission, network and bucket failures are never treated as absence. */
export function storageObjectExists(result: { data: unknown; error: { code?: string } | null }): boolean {
  if (result.error?.code === 'NoSuchKey') return false
  if (result.error) throw result.error
  if (!result.data) throw new Error('Invalid object metadata response')
  return true
}
