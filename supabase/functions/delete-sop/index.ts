// Supabase Edge Function: deletes SOP files together with their rows, which the browser can't do.
//
// The browser calls it with the signed-in user's token (supabase.functions.invoke('delete-sop')):
//   { action: "delete-sop", sopId, reason }       the main author deletes the whole SOP
//   { action: "delete-version", sopId, version }  the main author or uploader deletes one version
// 1. The token is checked with Supabase Auth.
// 2. public.delete_sop / public.delete_sop_version check the rules for that user, change the
//    rows in one transaction and return the file paths. Only service_role may call them.
// 3. The files are removed from the sop-files bucket. If that fails, the rows stay changed and
//    the request still succeeds: nobody can open a file without its version.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
// The service role key never leaves this function. See README.md to deploy it.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

const BUCKET = "sop-files"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Database error codes -> HTTP status and a stable code for the browser. */
const failures: Record<string, [number, string]> = {
  P0002: [404, "not-found"],
  "42501": [403, "not-allowed"],
  "23514": [409, "not-deletable"],
  "55006": [409, "check-running"],
  "22023": [400, "invalid-reason"],
}

type DeleteRequest =
  | { action: "delete-sop"; sopId: string; reason: string }
  | { action: "delete-version"; sopId: string; version: number }

function parse(body: unknown): DeleteRequest | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>
  if (typeof b.sopId !== "string" || !UUID.test(b.sopId)) return null
  if (b.action === "delete-sop" && typeof b.reason === "string") {
    return { action: "delete-sop", sopId: b.sopId, reason: b.reason }
  }
  if (b.action === "delete-version" && typeof b.version === "number" && Number.isInteger(b.version) && b.version >= 1) {
    return { action: "delete-version", sopId: b.sopId, version: b.version }
  }
  return null
}

/** A database refusal: its code (and its message, already written for the user); anything else is logged. */
function failure(error: { code?: string; message: string }, context: string): Response {
  const known = failures[error.code ?? ""]
  if (!known) {
    console.error(`delete-sop: ${context} failed:`, error.message)
    return json(500, { error: "failed" })
  }
  return json(known[0], { error: known[1], message: error.message })
}

/** Removes the files. A failure is logged, not returned. */
async function removeFiles(admin: SupabaseClient, context: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const { error } = await admin.storage.from(BUCKET).remove(paths)
  if (error) console.error(`delete-sop: ${context}: rows changed, files kept:`, error.message, JSON.stringify(paths))
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json(405, { error: "method-not-allowed" })

  const url = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !serviceKey) return json(500, { error: "not-configured" })
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // 1. Who is asking: the signed-in user from the request's token.
  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1]
  if (!token) return json(401, { error: "not-signed-in" })
  const { data: auth, error: authError } = await admin.auth.getUser(token)
  if (authError || !auth.user) return json(401, { error: "not-signed-in" })
  const actorId = auth.user.id

  let request: DeleteRequest | null
  try {
    request = parse(await req.json())
  } catch {
    request = null
  }
  if (!request) return json(400, { error: "invalid-request" })

  if (request.action === "delete-sop") {
    // 2. The rules and the rows, in the database.
    const { data, error } = await admin.rpc("delete_sop", { p_actor_id: actorId, p_sop_id: request.sopId, p_reason: request.reason })
    if (error) return failure(error, `SOP ${request.sopId} by ${actorId}`)
    const { code, title, paths } = data as { code: string; title: string; paths: string[] }
    // The only record of the deletion and its justification.
    console.log("delete-sop: SOP deleted", JSON.stringify({ code, title, sopId: request.sopId, actorId, justification: request.reason.trim() }))
    // 3. The files.
    await removeFiles(admin, code, paths)
    return json(200, { deleted: true })
  }

  const { data: path, error } = await admin.rpc("delete_sop_version", { p_actor_id: actorId, p_sop_id: request.sopId, p_version: request.version })
  if (error) return failure(error, `SOP ${request.sopId} v${request.version} by ${actorId}`)
  await removeFiles(admin, `SOP ${request.sopId} v${request.version}`, typeof path === "string" && path ? [path] : [])
  return json(200, { deleted: true })
})
