# access-requests (Request Hawkim)

The public **Request Hawkim** form (`/request-hawkim`) and the Hawkim team's **review page**
(`/review-request`) call this function. Requests are stored in `public.access_requests`
(migration `20261106130000_access_requests.sql`).

1. A visitor sends the form → the request is stored; `requests@tryhawkim.com` gets an email with a
   **Review request** button; the requester gets a confirmation.
2. The team opens the review page → **Accept** creates a new **organization** for the request (its name
   and Organization Profile from the request, and its starting departments Pharmacovigilance and
   Quality Assurance) and the account (Supabase Auth) with an active profile in it, the Admin permission
   and the **Super Admin** designation (the organization's initial Super Admin, without a department),
   and emails a **Set your password** link (to `/reset-password`); **Reject** tells the requester.
   One project holds any number of organizations (20261117130000). An email that already has an account
   in any organization is refused (`409 email_in_use`): one account belongs to one organization.
   `ADMIN_DEPARTMENT` is no longer used.

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
