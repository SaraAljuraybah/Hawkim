-- System Admins can read every department's published SOPs in the SOP Directory: the SOP row, its
-- published version and that version's file (so the detail page and Export PDF work). Only SOPs that
-- are published, not deleted and in their department's directory (not "Others"); only the published
-- (current) version, never an older or deleted one. Everything else about other departments' SOPs
-- stays as it is: older versions, drafts, reviews, comments, compliance checks, the timeline and
-- co-authors still use can_view_sop()/can_view_version(), which this migration doesn't change.
--
-- A published SOP's current version can't change: upload_sop_version() and delete_sop_version() only
-- run while the SOP is draft, returned or in review. The version check still applies if that changes.
--
-- Additive: adds three helper functions and three read policies (sops, sop_versions, storage.objects).
-- Policies are permissive, so every existing read policy still applies. No existing table, row,
-- function or policy changes.
-- Undo: supabase/scripts/rollback_admin_reads_published_sops.sql

begin;

-- Whether the signed-in person is an active System Admin and the SOP is a published directory SOP.
-- has_role() ignores ended profiles.
create function public.admin_can_read_published_sop(p_sop_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('admin'::public.app_role)
    and exists (
      select 1 from public.sops s
      where s.id = p_sop_id
        and s.deleted_at is null
        and s.status = 'published'::public.sop_status
        and s.directory_group = 'department'
    );
$$;

-- Whether this version is the published (current) version of such an SOP, and not deleted.
create function public.admin_can_read_published_version(p_sop_id uuid, p_version integer) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.admin_can_read_published_sop(p_sop_id)
    and exists (
      select 1 from public.sops s
      join public.sop_versions v on v.sop_id = s.id and v.version = s.current_version
      where s.id = p_sop_id and s.current_version = p_version and v.deleted_at is null
    );
$$;

-- Whether a file in sop-files is the published version's file of such an SOP. A function, as in
-- is_published_guideline_path(): it keeps storage.objects.name out of a subquery in the policy.
create function public.admin_can_read_published_sop_file(p_path text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sop_versions v
    where v.storage_path = p_path
      and v.deleted_at is null
      and public.admin_can_read_published_version(v.sop_id, v.version)
  );
$$;

alter function public.admin_can_read_published_sop(uuid) owner to postgres;
alter function public.admin_can_read_published_version(uuid, integer) owner to postgres;
alter function public.admin_can_read_published_sop_file(text) owner to postgres;
revoke all on function public.admin_can_read_published_sop(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_can_read_published_version(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.admin_can_read_published_sop_file(text) from public, anon, authenticated, service_role;
-- The policies run them as the signed-in user.
grant execute on function public.admin_can_read_published_sop(uuid) to authenticated;
grant execute on function public.admin_can_read_published_version(uuid, integer) to authenticated;
grant execute on function public.admin_can_read_published_sop_file(text) to authenticated;

create policy "System admins can read published SOPs"
on public.sops for select to authenticated
using (public.admin_can_read_published_sop(id));

create policy "System admins can read the published version of published SOPs"
on public.sop_versions for select to authenticated
using (deleted_at is null and public.admin_can_read_published_version(sop_id, version));

create policy "System admins can read the files of published SOPs"
on storage.objects for select to authenticated
using (
  bucket_id = 'sop-files'
  and (select public.is_active_user())
  and public.admin_can_read_published_sop_file(name)
);

commit;
