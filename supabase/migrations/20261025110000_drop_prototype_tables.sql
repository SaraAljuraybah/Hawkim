-- Removes the early prototype tables from the public schema. Nothing in the app uses them,
-- and "User" stored plain-text passwords. Runs before the phase 2 migration (20261025120000).
--
-- What exists (checked on the hosted project): five tables with their primary keys, two foreign
-- keys between them ("Requests".sender → "User".id, "User".dep → "DEPARTMENT"."Name") and an id
-- sequence owned by each of "PERMISSION", "Requests", "SOP" and "User". No views, functions,
-- triggers, policies, types or other schemas depend on them.
--
-- Each table is dropped after the tables that point at it. Dropping a table also drops its
-- keys, indexes and owned sequence. No cascade: if anything else unexpectedly depends on a
-- table, the migration stops instead of silently removing it.

drop table if exists public."Requests";    -- points at "User"
drop table if exists public."User";        -- points at "DEPARTMENT"
drop table if exists public."DEPARTMENT";
drop table if exists public."PERMISSION";
drop table if exists public."SOP";
