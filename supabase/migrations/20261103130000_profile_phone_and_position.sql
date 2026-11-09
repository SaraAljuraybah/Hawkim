-- Phone number and position (job title) for each person.
--
-- - phone: a Saudi mobile number, stored as +9665XXXXXXXX (the app accepts 05XXXXXXXX or
--   +9665XXXXXXXX, with spaces, and saves it in this form).
-- - position: free text, 1 to 100 characters, without surrounding spaces.
--
-- Both are nullable, so existing profiles stay valid; the admin's Add User form requires them.
-- They are read like the other profile columns: the table-level select grant and the policy
-- "Active users can read profiles" already cover new columns. No view lists profile columns, no
-- function returns a profile, and the triggers that read a whole profile row (check_co_author and
-- the internal review ones) don't use these columns, so nothing else changes.

alter table public.profiles
  add column phone text
    constraint profiles_phone_format check (phone ~ '^\+9665[0-9]{8}$'),
  add column "position" text
    constraint profiles_position_length check ("position" = trim("position") and char_length("position") between 1 and 100);
