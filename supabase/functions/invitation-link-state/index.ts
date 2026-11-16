// Set New Password, opened from an invitation link: is that invitation cancelled, replaced, expired, used or
// still valid? The link carries a random reference (?invitation=), which is all this function is given; it
// answers with the state only. The steps are in flow.ts.
//
// Signed-out callers reach no database function directly (only current_organization_id), so this function
// asks the database with the service key (invitation_link_state is granted to service_role only).
//
// Deploy with JWT verification off (the page is opened signed out; it calls this with the publishable key):
//   supabase functions deploy invitation-link-state --no-verify-jwt
//
// Provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or HAWKIM_SECRET_KEY with the project's secret key).

import { createClient } from "npm:@supabase/supabase-js@2.118.0"
import { linkStateFlow } from "./flow.ts"

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
  const serverKey = env("HAWKIM_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !serverKey) {
    console.error("invitation-link-state: not configured")
    return json(503, { errorCode: "failed" })
  }
  const server = createClient(url, serverKey, { auth: { persistSession: false, autoRefreshToken: false } })

  let input: unknown
  try {
    input = await request.json()
  } catch {
    input = undefined
  }

  const { status, body } = await linkStateFlow(input, async (linkRef) => {
    const { data, error } = await server.rpc("invitation_link_state", { p_link_ref: linkRef })
    if (error) throw new Error(`invitation_link_state ${error.code ?? "unknown"}`)
    return data
  }, (message) => console.log(`invitation-link-state: ${message}`))
  return json(status, body)
})
