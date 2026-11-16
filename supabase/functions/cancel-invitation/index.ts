// Cancel invitation (Staff → Sent Invitations): records the cancellation in the database as the calling
// Admin, then blocks the invited person's sign-in account in Auth so no link of theirs works. The staff
// profile and its details are kept (they are neither deactivated nor deleted). The steps are in flow.ts.
//
// Runs with JWT verification on, and checks in the database that the caller is an active Admin.
//   supabase functions deploy cancel-invitation --use-api
//
// Provided by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (or HAWKIM_SECRET_KEY
// with the project's secret key).

import { createClient } from "npm:@supabase/supabase-js@2.118.0"
import { DatabaseError } from "../add-user/flow.ts"
import { cancelInvitationFlow } from "./flow.ts"

const env = (name: string, fallback = "") => Deno.env.get(name) ?? fallback
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } })

/** 32 random bytes, stored by Auth as a hash and never shown to anyone. */
function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (request.method !== "POST") return json(405, { errorCode: "failed" })

  const url = env("SUPABASE_URL").replace(/\/$/, "")
  const publicKey = env("SUPABASE_ANON_KEY")
  const serverKey = env("HAWKIM_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !publicKey || !serverKey) {
    console.error("cancel-invitation: not configured")
    return json(503, { errorCode: "failed" })
  }

  const authorization = request.headers.get("Authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return json(401, { errorCode: "unauthorized" })
  // The caller's own client: the database checks them, and the audit row names them.
  const caller = createClient(url, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await caller.rpc(name, args)
    if (error) throw new DatabaseError(error)
    return data as T
  }

  let input: unknown
  try {
    input = await request.json()
  } catch {
    input = undefined
  }

  try {
    const { status, body } = await cancelInvitationFlow(input, {
      caller: async () => {
        const { data, error } = await caller.auth.getUser(authorization.slice(7))
        if (error || !data.user) return "unauthorized"
        const allowed = await caller.rpc("can_manage_organization")
        return !allowed.error && allowed.data === true ? "allowed" : "forbidden"
      },
      cancel: async (userId) => {
        const done = await rpc<{ cancelledAt?: unknown; already?: unknown } | null>("cancel_invitation", { p_user_id: userId })
        if (typeof done?.cancelledAt !== "string") throw new Error("cancel: unexpected response")
        return { cancelledAt: done.cancelledAt, already: done.already === true }
      },
      undo: async (userId, cancelledAt) => {
        await rpc("undo_invitation_cancel", { p_user_id: userId, p_cancelled_at: cancelledAt })
      },
      block: async (userId) => {
        // About a hundred years: Auth's ban has no "forever".
        const response = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
          method: "PUT",
          headers: { apikey: serverKey, Authorization: `Bearer ${serverKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ban_duration: "876000h", password: randomPassword() }),
        })
        if (!response.ok) throw new Error(`update account ${response.status}`)
      },
      log: (message) => console.log(`cancel-invitation: ${message}`),
    })
    return json(status, body)
  } catch (error) {
    console.error(`cancel-invitation: unexpected: ${error instanceof Error ? error.name : "unknown"}`)
    return json(500, { errorCode: "failed" })
  }
})
