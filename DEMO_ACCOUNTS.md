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

## Good to know (until the next phases)

- Sign-in, people, departments, the GVP guideline, new SOPs, their versions, files,
  co-authors and compliance checks come from the database and survive a reload.
  Compliance results are sample results until the compliance service is connected.
  Review requests, comments, status changes and their notifications are still kept in
  the browser and are lost on reload (the SOP is back in Draft).
- Until reviewers are in the database, reviewers can't open the SOP's file.
- The sample SOPs, requests and notifications belong to the old sample accounts, so
  they don't appear in My SOPs, My Reviews or My Requests, and sample authors and
  requesters show without a name. Test with new SOPs.
- Use one browser tab to pass an SOP between accounts: sign out, then sign in as the
  next person. Each tab has its own sign-in, and it ends when the tab closes.
- Accounts are created by the project owner in Supabase. A user added in
  Admin → Users can't sign in, and admin changes to users and departments are lost
  on reload.
