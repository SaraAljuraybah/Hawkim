# access-requests (Request Hawkim)

The public **Request Hawkim** form (`/request-hawkim`) and the Hawkim team's **review page**
(`/review-request`) call this function. Requests are stored in `public.access_requests`
(migration `20261106130000_access_requests.sql`).

1. A visitor sends the form → the request is stored; `requests@tryhawkim.com` gets an email with a
   **Review request** button; the requester gets a confirmation.
2. The team opens the review page → **Accept** creates the account (Supabase Auth) with an active
   profile in `ADMIN_DEPARTMENT`, the Admin permission and the **Super Admin** designation (the
   organization's initial Super Admin), and emails a **Set your password** link (to `/reset-password`);
   **Reject** tells the requester. A deployment that already has an Admin refuses with
   `409 deployment_onboarded` before any account is created: each organization has its own deployment
   (see `docs/admins.md`).

## Setup (once)

1. Apply the migration (the database owner). Since `20261115120000_request_organization_details.sql`
   the function sends the organization's details to the 13-parameter `submit_access_request`: apply that
   migration first, then deploy this function straight away (new requests fail in between).
2. Deploy with JWT verification off: `npx supabase functions deploy access-requests --no-verify-jwt`
   (or Dashboard → Edge Functions → Deploy a new function → Via editor, name `access-requests`,
   paste `access-requests-single-file.ts`, then turn JWT verification off in its settings).
3. Secrets: `SNDR_API_KEY` (already set for send-email). The function uses `SUPABASE_SERVICE_ROLE_KEY`,
   which Supabase provides; if the function answers `not_configured`, add `HAWKIM_SECRET_KEY` with
   the project's secret key (`sb_secret_…`).
4. Optional settings: `SITE_URL` (default `https://www.tryhawkim.com`), `REQUESTS_TO`
   (default `requests@tryhawkim.com`), `ADMIN_DEPARTMENT` (default `information-technology`).
5. Supabase → Authentication → URL Configuration → Redirect URLs must include the site
   (for example `https://www.tryhawkim.com/**`).

Logs: Dashboard → Edge Functions → access-requests → Logs (`access-requests: …`).
