import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { cleanDepartmentFilesUntilDone, type CleanupClaim } from './cleanup.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return json(405, { errorCode: 'method-not-allowed' })
  const url = Deno.env.get('SUPABASE_URL')
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serverKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !publicKey || !serverKey) return json(503, { errorCode: 'cleanup-not-configured' })
  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return json(401, { errorCode: 'unauthorized' })
  const user = createClient(url, publicKey, { global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false } })
  // Auth server verification, then the database's active/non-banned Admin check.
  const { data: identity, error: authError } = await user.auth.getUser(authorization.slice(7))
  if (authError || !identity.user) return json(401, { errorCode: 'unauthorized' })
  const { data: allowed, error: permissionError } = await user.rpc('can_read_organizational_structure')
  if (permissionError || allowed !== true) return json(403, { errorCode: 'forbidden' })
  let jobId: string | undefined
  try {
    let body: { jobId?: unknown; departmentId?: unknown; expectedUpdatedAt?: unknown; confirmDeleteSops?: unknown }
    try { body = await request.json() } catch { return json(400, { errorCode: 'invalid-request' }) }
    if (!body || typeof body !== 'object') return json(400, { errorCode: 'invalid-request' })
    if (body.jobId !== undefined) {
      if (typeof body.jobId !== 'string' || !uuid.test(body.jobId)) return json(400, { errorCode: 'invalid-request' })
      jobId = body.jobId
      const { error } = await user.rpc('get_department_file_deletion', { p_job_id: jobId })
      if (error) return json(409, { errorCode: 'conflict' })
    } else {
      if (typeof body.departmentId !== 'string' || typeof body.expectedUpdatedAt !== 'string' || body.confirmDeleteSops !== true) {
        return json(400, { errorCode: 'explicit-confirmation-required' })
      }
      const { data, error } = await user.rpc('begin_department_file_deletion', {
        p_id: body.departmentId, p_expected_updated_at: body.expectedUpdatedAt,
      })
      if (error) {
        if (error.code === '42501') return json(403, { errorCode: 'forbidden' })
        const errorCode = error.code === '23503' ? 'employees-assigned' : error.code === '23514' ? 'active-workflow' : 'conflict'
        return json(409, { errorCode })
      }
      jobId = data as string
    }
    if (!jobId || !uuid.test(jobId)) return json(500, { errorCode: 'invalid-job' })
    const server = createClient(url, serverKey, { auth: { persistSession: false, autoRefreshToken: false } })
    // Several bounded batches per request (time-boxed); a large job resumes on the next call.
    const state = await cleanDepartmentFilesUntilDone(jobId, {
      claim: async (id) => {
        const { data, error } = await server.rpc('claim_department_file_deletion', { p_job_id: id })
        if (error) throw error
        return data as CleanupClaim
      },
      remove: async (bucket, paths) => {
        const { error } = await server.storage.from(bucket).remove(paths)
        if (error) throw error
      },
      present: async (id, paths) => {
        const { data, error } = await server.rpc('department_file_paths_present', { p_job_id: id, p_paths: paths })
        if (error) throw error
        if (!Array.isArray(data)) throw new Error('Invalid presence response')
        return data as string[]
      },
      acknowledge: async (id, token, paths, failed) => {
        const { data, error } = await server.rpc('ack_department_file_deletion', {
          p_job_id: id, p_lease_token: token, p_deleted_paths: paths, p_failed: failed,
        })
        if (error) throw error
        return data as string
      },
    }, 20000)
    return json(state === 'completed' ? 200 : state === 'failed' ? 503 : 202, { jobId, state })
  } catch {
    // Do not return Storage credentials, internal paths, SQL diagnostics, or exception bodies.
    return json(503, { jobId, errorCode: 'storage-cleanup-incomplete' })
  }
})
