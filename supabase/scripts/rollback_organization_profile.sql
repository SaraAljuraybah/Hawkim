-- Undoes 20261113150000_organization_profile.sql: drops its two functions and the five columns it added.
-- The organization's name (organization_settings.name) is kept.
-- Data loss: the saved organization email, description, address, Google Maps link and website.
begin;

drop function if exists public.save_organization_profile(text, text, text, text, text, text);
drop function if exists public.get_organization_profile();
alter table public.organization_settings
  drop column if exists email,
  drop column if exists description,
  drop column if exists address,
  drop column if exists maps_url,
  drop column if exists website;

commit;
