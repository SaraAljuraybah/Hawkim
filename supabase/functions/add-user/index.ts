// Add User in the admin portal: creates the sign-in account, saves the profile and permissions
// through the database, and emails an invitation to set a password. The steps are in flow.ts.
// Add Staff with a deactivated staff member's email reactivates them (the same account and profile)
// with a new password-setup link; if that invitation can't be sent, they are deactivated again.
//
// Runs with JWT verification on, and checks in the database that the caller is an active Admin.
//   supabase functions deploy add-user --use-api
//
// Provided by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (or HAWKIM_SECRET_KEY
// with the project's secret key). Secrets: SNDR_API_KEY, shared with send-email. Optional settings:
// SITE_URL (default https://www.tryhawkim.com), SNDR_FROM, SNDR_API_URL.

import { createClient } from "npm:@supabase/supabase-js@2.118.0"
import { addUserFlow, DatabaseError, type SavedUser } from "./flow.ts"

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
  if (!url || !publicKey || !serverKey || !env("SNDR_API_KEY")) {
    console.error("add-user: not configured")
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
  // Auth's own links (invite for a new account, recovery for an existing one): they open Set New Password.
  const site = env("SITE_URL", "https://www.tryhawkim.com").replace(/\/$/, "")
  const generateLink = (type: string, email: string, extra: Record<string, unknown>) => authAdmin("generate_link", {
    method: "POST",
    body: JSON.stringify({ type, email, redirect_to: `${site}/reset-password`, ...extra }),
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
    const { status, body } = await addUserFlow(input, {
      caller: async () => {
        const { data, error } = await caller.auth.getUser(authorization.slice(7))
        if (error || !data.user) return "unauthorized"
        const allowed = await caller.rpc("can_manage_organization")
        return !allowed.error && allowed.data === true ? "allowed" : "forbidden"
      },
      checkNewUser: (user) => rpc("check_new_user", {
        p_email: user.email, p_full_name: user.name, p_phone: user.phone, p_position: user.position,
        p_department_id: user.departmentId, p_roles: user.permissions,
      }),
      accountLink: async (email, name) => {
        const response = await generateLink("invite", email, { data: { full_name: name } })
        if (response.status === 422) {
          // A sign-in account already exists: only its id now, no link. Its link is made by freshLink once
          // the profile is saved (a link made earlier would die when its password is replaced, and a
          // request refused later must never make one).
          // Auth's filter matches part of the email or name, so only an exact (case-insensitive) match counts,
          // page after page; never a similar address.
          for (let page = 1; page <= 20; page++) {
            const found = await authAdmin(`users?filter=${encodeURIComponent(email)}&page=${page}&per_page=100`)
            const list = await found.json().catch(() => null)
            if (!found.ok || !Array.isArray(list?.users)) throw new Error(`find account ${found.status}`)
            const account = list.users.find((user: { email?: string }) => user.email?.toLowerCase() === email)
            if (account?.id) return { id: account.id as string, link: "", existing: true }
            if (list.users.length < 100) break
          }
          throw new Error("find account: no exact match")
        }
        const account = await response.json().catch(() => null)
        if (!response.ok || !account?.id || !account?.action_link) throw new Error(`generate_link ${response.status}`)
        return { id: account.id, link: account.action_link, existing: false }
      },
      isBanned: async (id) => {
        const response = await authAdmin(`users/${id}`)
        const account = await response.json().catch(() => null)
        if (!response.ok || !account?.id) throw new Error(`read account ${response.status}`)
        return !!account.banned_until && new Date(account.banned_until).getTime() > Date.now()
      },
      profileState: async (id) => {
        // An Admin reads every profile, deactivated ones included (their names stay on history).
        const { data, error } = await caller.from("profiles").select("deleted_at").eq("id", id).maybeSingle()
        if (error) throw new Error(`read profile ${error.code}`)
        return !data ? "none" : data.deleted_at ? "deactivated" : "active"
      },
      setRandomPassword: async (id) => {
        const response = await authAdmin(`users/${id}`, { method: "PUT", body: JSON.stringify({ password: randomPassword() }) })
        if (!response.ok) throw new Error(`update account ${response.status}`)
      },
      addUser: (id, user) => rpc<SavedUser>("add_user", {
        p_user_id: id, p_email: user.email, p_full_name: user.name, p_phone: user.phone, p_position: user.position,
        p_department_id: user.departmentId, p_roles: user.permissions,
      }),
      freshLink: async (email) => {
        const response = await generateLink("recovery", email, {})
        const account = await response.json().catch(() => null)
        if (!response.ok || !account?.action_link) throw new Error(`generate_link ${response.status}`)
        return account.action_link as string
      },
      deactivate: (id) => rpc<unknown>("deactivate_staff", { p_user_id: id }).then(() => undefined),
      sendEmail: async (to, subject, html) => {
        const response = await fetch(env("SNDR_API_URL", "https://api.sndr.sh/v1/send"), {
          method: "POST",
          headers: { Authorization: `Bearer ${env("SNDR_API_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: env("SNDR_FROM", "Hawkim <no-reply@mail.tryhawkim.com>"), to: [to], subject, html }),
        })
        if (!response.ok) throw new Error(`SNDR ${response.status}`)
      },
      log: (message) => console.log(`add-user: ${message}`),
    })
    return json(status, body)
  } catch (error) {
    console.error(`add-user: unexpected: ${error instanceof Error ? error.name : "unknown"}`)
    return json(500, { errorCode: "failed" })
  }
})
