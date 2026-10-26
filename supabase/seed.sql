-- Seed data: departments, the GVP guideline with its requirements and the sample compliance
-- results, profiles and roles.
--
-- Run it AFTER the migrations and AFTER the sign-in accounts were created in the Supabase
-- dashboard (Authentication → Users). Profiles are linked to those accounts by email; a
-- person without an account is skipped and listed by the last query, so the file can be run
-- again once more accounts exist. Running it again updates names, departments, the guideline
-- and the sample results, and adds missing roles; it never removes a role.
--
-- Emails use the reserved test domain hawkim.test, never real addresses.

begin;

-- ---------- Departments ----------

-- is_quality: the only department with Approvers. requires_compliance_check: the GVP guideline
-- applies to its SOPs (Pharmacovigilance only).
insert into public.departments (id, name, initials, description, is_quality, requires_compliance_check) values
  ('quality-assurance', 'Quality Assurance', 'QA', 'Responsible for quality oversight and compliance.', true, false),
  ('regulatory-affairs', 'Regulatory Affairs', 'RA', 'Handles regulatory submissions and communications.', false, false),
  ('pharmacovigilance', 'Pharmacovigilance', 'PV', 'Monitors and evaluates product safety.', false, true),
  ('research-development', 'Research & Development', 'RD', 'Drives innovation and product development.', false, false),
  ('information-technology', 'Information Technology', 'IT', 'Supports the organization''s technology infrastructure.', false, false),
  ('human-resources', 'Human Resources', 'HR', 'Manages people, policies and culture.', false, false),
  ('finance-administration', 'Finance & Administration', 'FA', 'Oversees financial and administrative operations.', false, false),
  ('clinical-operations', 'Clinical Operations', 'CL', 'Supports clinical studies and operations.', false, false),
  ('legal-governance', 'Legal & Governance', 'LG', 'Ensures legal compliance and governance.', false, false)
on conflict (id) do update set
  name = excluded.name,
  initials = excluded.initials,
  description = excluded.description,
  is_quality = excluded.is_quality,
  requires_compliance_check = excluded.requires_compliance_check;

-- ---------- GVP guideline ----------

insert into public.guideline_versions (name, version, issued_date, effective_date, file_name) values
  ('SFDA Guideline on Good Pharmacovigilance Practices (GVP)', '4.0', '2015-05-27', '2015-09-01', 'Drug-GVP4_0.pdf')
on conflict (name, version) do update set
  issued_date = excluded.issued_date,
  effective_date = excluded.effective_date,
  file_name = excluded.file_name;

-- Requirements from GVP v4.0 (section numbers and pages as in the document; summaries paraphrased).
insert into public.guideline_requirements (guideline_version_id, code, module, section, section_title, short_title, page, summary)
select g.id, r.code, r.module, r.section, r.section_title, r.short_title, r.page, r.summary
from public.guideline_versions g
cross join (values
  ('R1', 'Module I', 'I.B.10', 'Record management', 'Access to pharmacovigilance records', 22,
   'Access to pharmacovigilance documents and databases is strictly limited to authorized personnel.'),
  ('R2', 'Module I', 'I.B.10', 'Record management', 'Retention of records', 22,
   'Pharmacovigilance data and records are protected from destruction during the applicable retention period.'),
  ('R3', 'Module I', 'I.B.10', 'Record management', 'Timely access to records', 22,
   'The record management system supports timely access to all records.'),
  ('R4', 'Module I', 'I.C.1.4', 'Specific quality system processes of the MAH in KSA', 'Back-up and security of electronic records', 34,
   'Documents may be retained electronically only if the system is validated, with appropriate arrangements for system security, access and back-up of data.'),
  ('R5', 'Module I', 'I.B.7', 'Training of personnel for pharmacovigilance', 'Training of personnel', 19,
   'Personnel receive initial and continued training, and training records are kept.')
) as r (code, module, section, section_title, short_title, page, summary)
where g.name = 'SFDA Guideline on Good Pharmacovigilance Practices (GVP)' and g.version = '4.0'
on conflict (guideline_version_id, code) do update set
  module = excluded.module,
  section = excluded.section,
  section_title = excluded.section_title,
  short_title = excluded.short_title,
  page = excluded.page,
  summary = excluded.summary;

-- The results every sample check gets (the real compliance service isn't connected yet).
insert into public.sample_findings (guideline_version_id, requirement_id, position, result, justification, sop_reference, recommended_action)
select g.id, q.id, f.position, f.result::public.compliance_result, f.justification, f.sop_reference, f.recommended_action
from public.guideline_versions g
cross join (values
  ('R1', 1, 'compliant',
   'Sample finding: the SOP describes role-based access approval for the system.',
   'Section 4.2', null),
  ('R2', 2, 'partial',
   'Sample finding: the SOP describes regular back-ups of records but does not say how long pharmacovigilance records are kept.',
   'Section 5.1', 'Sample recommendation: state how long pharmacovigilance records are kept and how they are protected during that period.'),
  ('R3', 3, 'compliant',
   'Sample finding: the SOP explains how records are indexed so they can be found and retrieved on request.',
   'Section 5.3', null),
  ('R4', 4, 'conflict',
   'Sample finding: the SOP stores archived records on a system with no scheduled back-up, which conflicts with the back-up requirement.',
   'Section 6.2', 'Sample recommendation: define a scheduled, tested back-up for the archive system.'),
  ('R5', 5, 'not-addressed',
   'Sample finding: the SOP does not mention training for staff who perform this procedure.',
   null, 'Sample recommendation: describe the initial and continued training for staff who perform this procedure, and where training records are kept.')
) as f (code, position, result, justification, sop_reference, recommended_action)
join public.guideline_requirements q on q.guideline_version_id = g.id and q.code = f.code
where g.name = 'SFDA Guideline on Good Pharmacovigilance Practices (GVP)' and g.version = '4.0'
on conflict (guideline_version_id, position) do update set
  requirement_id = excluded.requirement_id,
  result = excluded.result,
  justification = excluded.justification,
  sop_reference = excluded.sop_reference,
  recommended_action = excluded.recommended_action;

-- ---------- People ----------
-- One row per person: email, name, initials, home department, roles (empty: no role).

-- A temporary list for this session only (it disappears when the session ends).
drop table if exists seed_people;
create temporary table seed_people (
  email text primary key,
  full_name text not null,
  initials text not null,
  department_id text not null,
  roles public.app_role[] not null
);

insert into seed_people (email, full_name, initials, department_id, roles) values
  -- Pharmacovigilance (the demo's department: its SOPs get a compliance check)
  ('sara.aljuraybah@hawkim.test', 'Sara Aljuraybah', 'SA', 'pharmacovigilance', '{author}'),
  ('reem.alsubaie@hawkim.test', 'Reem Alsubaie', 'RA', 'pharmacovigilance', '{author}'),
  ('noura.alqahtani@hawkim.test', 'Noura Alqahtani', 'NA', 'pharmacovigilance', '{reviewer}'),
  ('lulwah.alrasheed@hawkim.test', 'Lulwah Alrasheed', 'LA', 'pharmacovigilance', '{reviewer}'),
  ('omar.alghamdi@hawkim.test', 'Omar Alghamdi', 'OA', 'pharmacovigilance', '{author}'),
  ('lama.alshehri@hawkim.test', 'Lama Alshehri', 'LA', 'pharmacovigilance', '{reviewer}'),
  -- Information Technology
  ('nouf.almutairi@hawkim.test', 'Nouf Almutairi', 'NA', 'information-technology', '{admin}'),
  -- Quality Assurance (the only department with Approvers)
  ('faisal.alharbi@hawkim.test', 'Faisal Alharbi', 'FA', 'quality-assurance', '{reviewer}'),
  ('abeer.alhamdan@hawkim.test', 'Abeer Alhamdan', 'AA', 'quality-assurance', '{author,reviewer}'),
  ('khalid.alzahrani@hawkim.test', 'Khalid Alzahrani', 'KA', 'quality-assurance', '{approver}'),
  ('huda.alotaibi@hawkim.test', 'Huda Alotaibi', 'HA', 'quality-assurance', '{approver}'),
  ('maha.alenazi@hawkim.test', 'Maha Alenazi', 'MA', 'quality-assurance', '{approver}'),
  ('sultan.aldosari@hawkim.test', 'Sultan Aldosari', 'SA', 'quality-assurance', '{approver}'),
  ('shahad.alghamdi@hawkim.test', 'Shahad Alghamdi', 'SA', 'quality-assurance', '{}'),
  -- Regulatory Affairs
  ('abdullah.alqahtani@hawkim.test', 'Abdullah Alqahtani', 'AA', 'regulatory-affairs', '{reviewer}'),
  -- Employees without a role
  ('rawan.alzahrani@hawkim.test', 'Rawan Alzahrani', 'RA', 'research-development', '{}'),
  ('turki.alshammari@hawkim.test', 'Turki Alshammari', 'TA', 'research-development', '{}'),
  ('hessa.alqahtani@hawkim.test', 'Hessa Alqahtani', 'HA', 'human-resources', '{}'),
  ('nasser.alotaibi@hawkim.test', 'Nasser Alotaibi', 'NA', 'human-resources', '{}'),
  ('dalal.alharbi@hawkim.test', 'Dalal Alharbi', 'DA', 'finance-administration', '{}'),
  ('fahad.alanazi@hawkim.test', 'Fahad Alanazi', 'FA', 'clinical-operations', '{}'),
  ('joud.almutairi@hawkim.test', 'Joud Almutairi', 'JA', 'clinical-operations', '{}'),
  ('bandar.aldossary@hawkim.test', 'Bandar Aldossary', 'BA', 'legal-governance', '{}');

-- A profile for every person who has a sign-in account (matched by email, ignoring case).
insert into public.profiles (id, full_name, email, initials, department_id)
select u.id, s.full_name, s.email, s.initials, s.department_id
from seed_people s
join auth.users u on lower(u.email) = s.email
on conflict (id) do update set
  full_name = excluded.full_name,
  email = excluded.email,
  initials = excluded.initials,
  department_id = excluded.department_id;

-- Their roles (the role rule triggers check each one).
insert into public.user_roles (user_id, role)
select p.id, r.role
from seed_people s
join public.profiles p on p.email = s.email and p.deleted_at is null
cross join lateral unnest(s.roles) as r(role)
on conflict (user_id, role) do nothing;

commit;

-- People in this file who don't have a sign-in account yet (empty when everyone was linked).
select s.email as missing_account, s.department_id, s.roles
from seed_people s
where not exists (select 1 from auth.users u where lower(u.email) = s.email)
order by s.department_id, s.email;
