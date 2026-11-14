-- Undoes 20261113130000_staff_reactivation.sql: drops reactivate_staff and puts back the versions of
-- save_user, update_user_details, set_user_email and guard_employee_position that only accept active profiles.
-- Run it as the database owner in the SQL Editor, then re-run the CREATE OR REPLACE statements for those four
-- functions from their previous migrations, in this order:
--   1. save_user            from 20261112120000_staff_deactivation.sql (section 3)
--   2. update_user_details  from 20261107130000_update_user_details.sql
--   3. set_user_email       from 20261111120000_super_admin.sql
--   4. guard_employee_position from 20261107120300_employee_positions.sql
-- Staff reactivated while it was in place stay active (their profile is simply active again).
begin;

drop function if exists public.reactivate_staff(uuid);

commit;
