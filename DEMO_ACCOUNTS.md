# Hawkim — Demo and Experimental Test Accounts

## Active local prototype

Use one of these `.demo` emails with any non-empty demo password. No password is checked or sent. Supabase configuration is unnecessary; environment keys do not enable integration.

| Name | Email | Department | Role |
|---|---|---|---|
| Nouf Almutairi | nouf.almutairi@hawkim.demo | Information Technology | Admin |
| Sara Aljuraybah | sara.aljuraybah@hawkim.demo | Information Technology | Author |
| Reem Alsubaie | reem.alsubaie@hawkim.demo | Information Technology | Author |
| Noura Alqahtani | noura.alqahtani@hawkim.demo | Information Technology | Reviewer |
| Huda Alotaibi | huda.alotaibi@hawkim.demo | Information Technology | Approver |
| Rawan Alzahrani | rawan.alzahrani@hawkim.demo | Research & Development | Employee (no additional role) |

Additional local identities are defined in `frontend/src/data/mock/users.ts`.

- Identity, SOPs, files, review/approval decisions, requests and admin changes stay in this browser tab's memory and reset on reload.
- Sign out and sign in as another demo user in the same tab to continue the shared workflow. Each user sees only authorized SOPs and versions. Tabs do not synchronize.
- Compliance checks produce sample results and are required for every SOP in the active prototype.
- New review requests use a fixed two-working-day response deadline and an optional 1–30 working-day review duration, in Asia/Riyadh with Friday/Saturday weekends. Saved legacy deadlines retain their original policy.
- The main Author controls new reviewer assignments and the separate approval handoff. Existing saved reviewer handoffs retain their assignments and deadlines; new cross-department routing is pending.

## Experimental Supabase integration (disabled)

The following accounts and behavior document the retained integration implementation. It remains disabled by `FRONTEND_PROTOTYPE = true` and requires a separately approved code change before use.

The integration signs in with real Supabase accounts. Passwords are never stored in this repository; ask the project owner for the shared test password.

Its setup uses `frontend/.env.example`, copied to `frontend/.env.local` with the Supabase URL and publishable key (see the README). Never use a secret (`service_role`) key.

| Email | Department | Roles |
|---|---|---|
| sara.aljuraybah@hawkim.test | Pharmacovigilance | Author |
| reem.alsubaie@hawkim.test | Pharmacovigilance | Author |
| omar.alghamdi@hawkim.test | Pharmacovigilance | Author |
| noura.alqahtani@hawkim.test | Pharmacovigilance | Reviewer |
| lulwah.alrasheed@hawkim.test | Pharmacovigilance | Reviewer |
| abeer.alhamdan@hawkim.test | Quality Assurance | Author, Reviewer |
| faisal.alharbi@hawkim.test | Quality Assurance | Reviewer |
| nouf.almutairi@hawkim.test | Information Technology | Admin |
| rawan.alzahrani@hawkim.test | Research & Development | No role |

The compliance check (against the SFDA GVP guideline) is only for Pharmacovigilance SOPs.
SOPs of every other department are submitted for review without a check.

### Integration behavior retained for review

- Sign-in, people, departments, the GVP guideline, SOPs, their versions and files,
  co-authors, compliance checks, the internal review (requests, decisions, comments,
  responses) and its notifications come from the database and survive a reload.
  Compliance results are sample results until the compliance service is connected.
- Not connected yet: approval, the admin portal's changes, requests, guideline upload
  and which notifications were read. These stay in the browser and are lost on reload.
- Unanswered review requests are withdrawn when their response due date ends, the next
  time the SOP is opened or acted on (a scheduled job will do it on the server later).
- The sample SOPs, requests and notifications belong to the old sample accounts, so
  they don't appear in My SOPs, My Reviews or My Requests, and sample authors and
  requesters show without a name. Test with new SOPs.
- Each browser tab has its own sign-in, and it ends when the tab closes, so you can be
  the author in one tab and a reviewer in another (reload to see the other's changes).
- Accounts are created by the project owner in Supabase. A user added in
  Admin → Users can't sign in, and admin changes to users and departments are lost
  on reload.
