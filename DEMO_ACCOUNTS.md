# Hawkim — Test Accounts

Sign-in uses real Supabase accounts. Passwords are never stored in this repository;
ask the project owner for the shared test password.

Setup: copy `frontend/.env.example` to `frontend/.env.local` and fill in the Supabase
URL and publishable key (see the README).

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

## Good to know

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
