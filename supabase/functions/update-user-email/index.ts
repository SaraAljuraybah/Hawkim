// Edit Staff in the admin portal: changes a staff member's email in both places, their sign-in
// account and their profile, so they keep signing in with the email shown in Hawkim. The steps are in flow.ts.
//
// Runs with JWT verification on, and checks in the database that the caller is an active Admin.
//   supabase functions deploy update-user-email --use-api
//
// Provided by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (or HAWKIM_SECRET_KEY
// with the project's secret key).

import { createClient } from "npm:@supabase/supabase-js@2.118.0"
import { DatabaseError, EmailInUseError, updateEmailFlow } from "./flow.ts"

const env = (name: string, fallback = "") => Deno.env.get(name) ?? fallback
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } })

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (request.method !== "POST") return json(405, { errorCode: "failed" })

  const url = env("SUPABASE_URL").replace(/\/$/, "")
  const publicKey = env("SUPABASE_ANON_KEY")
  const serverKey = env("HAWKIM_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !publicKey || !serverKey) {
    console.error("update-user-email: not configured")
    return json(503, { errorCode: "failed" })
  }

  const authorization = request.headers.get("Authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return json(401, { errorCode: "unauthorized" })
  // The caller's own client: the database checks them, and the audit rows name them.
  const caller = createClient(url, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const authAdmin = (path: string, init: RequestInit = {}) => fetch(`${url}/auth/v1/admin/${path}`, {
    ...init,
    headers: { apikey: serverKey, Authorization: `Bearer ${serverKey}`, "Content-Type": "application/json" },
  })

  let input: unknown
  try {
    input = await request.json()
  } catch {
    input = undefined
  }

  try {
    const { status, body } = await updateEmailFlow(input, {
      caller: async () => {
        const { data, error } = await caller.auth.getUser(authorization.slice(7))
        if (error || !data.user) return "unauthorized"
        const allowed = await caller.rpc("can_manage_organization")
        return !allowed.error && allowed.data === true ? "allowed" : "forbidden"
      },
      setProfileEmail: async (userId, email, apply) => {
        const { error } = await caller.rpc("set_user_email", { p_user_id: userId, p_email: email, p_apply: apply })
        if (error) throw new DatabaseError(error)
      },
      accountEmail: async (userId) => {
        const response = await authAdmin(`users/${userId}`)
        if (response.status === 404) return undefined
        const account = await response.json().catch(() => null)
        if (!response.ok || !account?.id) throw new Error(`read account ${response.status}`)
        return typeof account.email === "string" ? account.email : ""
      },
      setAccountEmail: async (userId, email) => {
        const response = await authAdmin(`users/${userId}`, { method: "PUT", body: JSON.stringify({ email, email_confirm: true }) })
        if (response.status === 422) throw new EmailInUseError()
        if (!response.ok) throw new Error(`update account ${response.status}`)
      },
      log: (message) => console.log(`update-user-email: ${message}`),
    })
    return json(status, body)
  } catch (error) {
    console.error(`update-user-email: unexpected: ${error instanceof Error ? error.name : "unknown"}`)
    return json(500, { errorCode: "failed" })
  }
})
