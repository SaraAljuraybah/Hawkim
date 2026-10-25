-- Seed data: departments, profiles and roles.
--
-- Run it AFTER the migrations and AFTER the sign-in accounts were created in the Supabase
-- dashboard (Authentication → Users). Profiles are linked to those accounts by email; a
-- person without an account is skipped and listed by the last query, so the file can be run
-- again once more accounts exist. Running it again updates names and departments and adds
-- missing roles; it never removes a role.
--
-- Emails use the reserved test domain hawkim.test, never real addresses.

begin;

-- ---------- Departments ----------

insert into public.departments (id, name, initials, description, is_quality) values
  ('quality-assurance', 'Quality Assurance', 'QA', 'Responsible for quality oversight and compliance.', true),
  ('regulatory-affairs', 'Regulatory Affairs', 'RA', 'Handles regulatory submissions and communications.', false),
  ('pharmacovigilance', 'Pharmacovigilance', 'PV', 'Monitors and evaluates product safety.', false),
  ('research-development', 'Research & Development', 'RD', 'Drives innovation and product development.', false),
  ('information-technology', 'Information Technology', 'IT', 'Supports the organization''s technology infrastructure.', false),
  ('human-resources', 'Human Resources', 'HR', 'Manages people, policies and culture.', false),
  ('finance-administration', 'Finance & Administration', 'FA', 'Oversees financial and administrative operations.', false),
  ('clinical-operations', 'Clinical Operations', 'CL', 'Supports clinical studies and operations.', false),
  ('legal-governance', 'Legal & Governance', 'LG', 'Ensures legal compliance and governance.', false)
on conflict (id) do update set
  name = excluded.name,
  initials = excluded.initials,
  description = excluded.description,
  is_quality = excluded.is_quality;

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
  -- Information Technology
  ('sara.aljuraybah@hawkim.test', 'Sara Aljuraybah', 'SA', 'information-technology', '{author}'),
  ('reem.alsubaie@hawkim.test', 'Reem Alsubaie', 'RA', 'information-technology', '{author}'),
  ('noura.alqahtani@hawkim.test', 'Noura Alqahtani', 'NA', 'information-technology', '{reviewer}'),
  ('lulwah.alrasheed@hawkim.test', 'Lulwah Alrasheed', 'LA', 'information-technology', '{reviewer}'),
  ('nouf.almutairi@hawkim.test', 'Nouf Almutairi', 'NA', 'information-technology', '{admin}'),
  -- Quality Assurance (the only department with Approvers)
  ('faisal.alharbi@hawkim.test', 'Faisal Alharbi', 'FA', 'quality-assurance', '{reviewer}'),
  ('abeer.alhamdan@hawkim.test', 'Abeer Alhamdan', 'AA', 'quality-assurance', '{author,reviewer}'),
  ('khalid.alzahrani@hawkim.test', 'Khalid Alzahrani', 'KA', 'quality-assurance', '{approver}'),
  ('huda.alotaibi@hawkim.test', 'Huda Alotaibi', 'HA', 'quality-assurance', '{approver}'),
  ('maha.alenazi@hawkim.test', 'Maha Alenazi', 'MA', 'quality-assurance', '{approver}'),
  ('sultan.aldosari@hawkim.test', 'Sultan Aldosari', 'SA', 'quality-assurance', '{approver}'),
  ('shahad.alghamdi@hawkim.test', 'Shahad Alghamdi', 'SA', 'quality-assurance', '{}'),
  -- Pharmacovigilance
  ('omar.alghamdi@hawkim.test', 'Omar Alghamdi', 'OA', 'pharmacovigilance', '{author}'),
  ('lama.alshehri@hawkim.test', 'Lama Alshehri', 'LA', 'pharmacovigilance', '{reviewer}'),
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
