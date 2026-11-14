-- Undoes 20261110130000_admin_reads_published_sops.sql: System Admins see only their own department's
-- published SOPs again (other departments' SOPs leave the admin SOP Directory, and their detail pages
-- show "This SOP belongs to …"). No data is lost.
begin;
drop policy if exists "System admins can read the files of published SOPs" on storage.objects;
drop policy if exists "System admins can read the published version of published SOPs" on public.sop_versions;
drop policy if exists "System admins can read published SOPs" on public.sops;
drop function if exists public.admin_can_read_published_sop_file(text);
drop function if exists public.admin_can_read_published_version(uuid, integer);
drop function if exists public.admin_can_read_published_sop(uuid);
commit;
