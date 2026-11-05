/** Shared, testable worker. Only its caller holds the server credential. */
export interface CleanupFile { bucket: string; path: string }
export interface CleanupClaim { state: string; leaseToken?: string; files?: CleanupFile[] }
export interface CleanupDependencies {
  claim: (jobId: string) => Promise<CleanupClaim>
  remove: (bucket: string, paths: string[]) => Promise<void>
  exists: (bucket: string, path: string) => Promise<boolean>
  acknowledge: (jobId: string, token: string, paths: string[], failed: boolean) => Promise<string>
}

export async function cleanDepartmentFiles(jobId: string, dependencies: CleanupDependencies): Promise<string> {
  const claim = await dependencies.claim(jobId)
  if (claim.state === 'completed' || claim.state === 'busy') return claim.state
  if (claim.state !== 'processing' || !claim.leaseToken || !Array.isArray(claim.files)) throw new Error('Invalid cleanup claim')
  const deleted: string[] = []
  let failed = false
  try {
    if (claim.files.some((file) => file.bucket !== 'sop-files' || !file.path || file.path.startsWith('/') || file.path.split('/').includes('..'))) {
      throw new Error('Invalid cleanup ownership')
    }
    if (claim.files.length) {
      await dependencies.remove('sop-files', claim.files.map((file) => file.path))
      // Storage success alone is insufficient: verify absence, including retrying a path
      // already removed by a prior worker whose acknowledgement was lost.
      for (let start = 0; start < claim.files.length; start += 10) {
        const checks = await Promise.allSettled(claim.files.slice(start, start + 10).map(async (file) => {
          if (await dependencies.exists(file.bucket, file.path)) throw new Error('Object remains')
          return file.path
        }))
        for (const result of checks) {
          if (result.status === 'fulfilled') deleted.push(result.value)
          else failed = true
        }
      }
    }
  } catch { failed = true }
  // If this acknowledgement fails, the persisted lease eventually expires and a retry
  // re-verifies files. Never report completion or guess which objects were deleted.
  return dependencies.acknowledge(jobId, claim.leaseToken, deleted, failed)
}

/** The Storage HEAD helper returns an error even for absence. Inspect GET metadata's
 * explicit NoSuchKey code instead; permission/network/bucket failures are never absence. */
export function storageObjectExists(result: { data: unknown; error: { code?: string } | null }): boolean {
  if (result.error?.code === 'NoSuchKey') return false
  if (result.error) throw result.error
  if (!result.data) throw new Error('Invalid object metadata response')
  return true
}
