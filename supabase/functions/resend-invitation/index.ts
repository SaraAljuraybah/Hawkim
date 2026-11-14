// Resend invitation (the admin portal's expired-invitation notification): records the new sending in
// the database as the calling Admin, makes a new activation link and emails it. The steps are in flow.ts.
//
// Runs with JWT verification on, and checks in the database that the caller is an active Admin.
//   supabase functions deploy resend-invitation --use-api
//
// Provided by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (or HAWKIM_SECRET_KEY
// with the project's secret key). Secrets: SNDR_API_KEY, shared with send-email and add-user. Optional
// settings: SITE_URL (default https://www.tryhawkim.com), SNDR_FROM, SNDR_API_URL.

import { createClient } from "npm:@supabase/supabase-js@2.118.0"
import { DatabaseError } from "../add-user/flow.ts"
import { resendInvitationFlow } from "./flow.ts"

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
  if (!url || !publicKey || !serverKey || !env("SNDR_API_KEY")) {
    console.error("resend-invitation: not configured")
    return json(503, { errorCode: "failed" })
  }

  const authorization = request.headers.get("Authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return json(401, { errorCode: "unauthorized" })
  // The caller's own client: the database checks them, and records them as the sender.
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
    const { status, body } = await resendInvitationFlow(input, {
      caller: async () => {
        const { data, error } = await caller.auth.getUser(authorization.slice(7))
        if (error || !data.user) return "unauthorized"
        const allowed = await caller.rpc("can_manage_organization")
        return !allowed.error && allowed.data === true ? "allowed" : "forbidden"
      },
      claim: async (userId) => {
        const claimed = await rpc<{ email?: unknown; claimedAt?: unknown } | null>("claim_invitation_resend", { p_user_id: userId })
        if (typeof claimed?.email !== "string" || typeof claimed.claimedAt !== "string") throw new Error("claim: unexpected response")
        return { email: claimed.email, claimedAt: claimed.claimedAt }
      },
      revert: async (userId, claimedAt) => {
        await rpc("revert_invitation_resend", { p_user_id: userId, p_claimed_at: claimedAt })
      },
      // A recovery link for the existing account: it replaces any earlier link and opens Set New Password.
      newLink: async (email) => {
        const site = env("SITE_URL", "https://www.tryhawkim.com").replace(/\/$/, "")
        const response = await fetch(`${url}/auth/v1/admin/generate_link`, {
          method: "POST",
          headers: { apikey: serverKey, Authorization: `Bearer ${serverKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ type: "recovery", email, redirect_to: `${site}/reset-password` }),
        })
        const account = await response.json().catch(() => null)
        if (!response.ok || !account?.action_link) throw new Error(`generate_link ${response.status}`)
        return account.action_link as string
      },
      sendEmail: async (to, subject, html) => {
        const response = await fetch(env("SNDR_API_URL", "https://api.sndr.sh/v1/send"), {
          method: "POST",
          headers: { Authorization: `Bearer ${env("SNDR_API_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: env("SNDR_FROM", "Hawkim <no-reply@mail.tryhawkim.com>"), to: [to], subject, html }),
        })
        if (!response.ok) throw new Error(`SNDR ${response.status}`)
      },
      log: (message) => console.log(`resend-invitation: ${message}`),
    })
    return json(status, body)
  } catch (error) {
    console.error(`resend-invitation: unexpected: ${error instanceof Error ? error.name : "unknown"}`)
    return json(500, { errorCode: "failed" })
  }
})
