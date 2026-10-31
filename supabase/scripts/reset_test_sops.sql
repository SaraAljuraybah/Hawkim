-- Deletes EVERY SOP and everything that belongs to SOPs, and resets the numbering so the next
-- SOP created is SOP-001. For test data only (e.g. before a demo). It can't be undone.
--
-- Run it yourself in the Supabase SQL Editor (it is not a migration). It keeps departments,
-- profiles, roles, the guideline, its requirements and the sample findings.
--
-- Files in the sop-files bucket are kept. Nothing points at them any more, so nobody can
-- open them (a file can only be read through a version) and new uploads never reuse their
-- random names. They only take up space; remove them from Storage → sop-files if you want.

begin;

-- Who did what on each SOP (points at review requests, rounds and comments).
delete from public.timeline_events;

-- Requests and comments point at each other: unlink the requests from their comments first.
update public.review_requests set comment_id = null where comment_id is not null;
delete from public.sop_comments;
delete from public.review_requests;
delete from public.review_rounds;

-- Compliance results, then the checks.
delete from public.compliance_findings;
delete from public.compliance_checks;

delete from public.sop_co_authors;

-- Versions, then the SOPs (an SOP's link to its current version is only checked at commit).
delete from public.sop_versions;
delete from public.sops;

-- The next SOP created is SOP-001.
update public.sop_code_counter set last_number = 0;

commit;

-- Everything above should be 0, and the reference data still there.
select 'sops' as table_name, count(*) from public.sops
union all select 'sop_versions', count(*) from public.sop_versions
union all select 'sop_co_authors', count(*) from public.sop_co_authors
union all select 'compliance_checks', count(*) from public.compliance_checks
union all select 'compliance_findings', count(*) from public.compliance_findings
union all select 'review_rounds', count(*) from public.review_rounds
union all select 'review_requests', count(*) from public.review_requests
union all select 'sop_comments', count(*) from public.sop_comments
union all select 'timeline_events', count(*) from public.timeline_events
union all select 'sop_code_counter.last_number', last_number from public.sop_code_counter
union all select 'departments (kept)', count(*) from public.departments
union all select 'profiles (kept)', count(*) from public.profiles
union all select 'guideline_requirements (kept)', count(*) from public.guideline_requirements
union all select 'sample_findings (kept)', count(*) from public.sample_findings;
