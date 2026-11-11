-- Fixtures for 20261112140000_admins_without_department.sql, kept (not rolled back): run on a disposable
-- LOCAL database with every earlier migration applied, BEFORE that migration, then the migration, then
-- admins_without_department.sql. Never on the shared project.
--   1. admins_without_department_before.sql   (this file)
--   2. migrations/20261112140000_admins_without_department.sql
--   3. admins_without_department.sql           (assertions, rolled back)
--   4. admins_without_department_request.sql   (a request without a position, kept)
--   5. scripts/rollback_admins_without_department.sql
--   6. admins_without_department_rolled_back.sql
begin;

insert into public.departments (id, name, initials) values ('aw-it', 'AW IT', 'AI'), ('aw-ops', 'AW Ops', 'AO') on conflict do nothing;

-- 1 a Super Admin with a department, position and its row (as Sara on the live project);
-- 2 an Admin with a department and two positions; 3 an Admin with a department but no position (as the
-- seed Admin Nouf, from before positions were required); 4 an Admin already without either (as Dalal);
-- 5 a deactivated Admin with a department (left as is); 6 staff with a department and position.
insert into auth.users (id, email)
select ('9e000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'aw-' || n || '@test.invalid' from generate_series(1, 6) n;

-- Nouf's state can't be made any more (a department now needs a position): only for this fixture.
alter table public.profiles disable trigger profiles_require_position;
insert into public.profiles (id, full_name, email, initials, department_id, "position", deleted_at) values
  ('9e000000-0000-4000-8000-000000000001', 'AW Super', 'aw-1@test.invalid', 'AS', 'aw-it', 'IT', null),
  ('9e000000-0000-4000-8000-000000000002', 'AW Two Positions', 'aw-2@test.invalid', 'AT', 'aw-it', 'Systems Lead', null),
  ('9e000000-0000-4000-8000-000000000003', 'AW No Position', 'aw-3@test.invalid', 'AN', 'aw-it', null, null),
  ('9e000000-0000-4000-8000-000000000005', 'AW Ended', 'aw-5@test.invalid', 'AE', 'aw-it', 'Former Lead', now()),
  ('9e000000-0000-4000-8000-000000000006', 'AW Staff', 'aw-6@test.invalid', 'SF', 'aw-ops', 'Specialist', null);
alter table public.profiles enable trigger profiles_require_position;
-- Without a department: after the rule is back (the deferred department rule is checked at commit, once its Admin role exists).
insert into public.profiles (id, full_name, email, initials) values ('9e000000-0000-4000-8000-000000000004', 'AW Clear', 'aw-4@test.invalid', 'AC');
-- Admin 2's second position, listed first (sort_order 0 goes to the main one by the sync trigger).
insert into public.employee_positions (profile_id, department_id, title, sort_order)
values ('9e000000-0000-4000-8000-000000000002', 'aw-it', 'Backup Lead', 5);

insert into public.user_roles (user_id, role)
select ('9e000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, case when n = 6 then 'author' else 'admin' end::public.app_role
from generate_series(1, 6) n;

alter table public.super_admin disable trigger user;
delete from public.super_admin;
alter table public.super_admin enable trigger user;
insert into public.super_admin (user_id) values ('9e000000-0000-4000-8000-000000000001');

-- A request from before: its position stays.
insert into public.access_requests (organization, contact_name, job_title, email, phone, approx_users, review_token_hash, review_expires_at)
values ('AW Old Pharma', 'Old Applicant', 'QPPV', 'aw-old@test.invalid', '+966500000000', 10, repeat('c', 64), now() + interval '14 days');

commit;
