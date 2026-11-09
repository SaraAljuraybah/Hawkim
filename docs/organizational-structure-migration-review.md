# Migration privilege and transaction review

Reviewed `supabase/migrations/20261104130000_reconcile_organizational_structure.sql`. The owner confirms the live schema, policies and authorization helpers have been inspected and are compatible. This follow-up performed no production queries, migrations, data resets, pushes or merges.

## Revocation syntax

`REVOKE ALL (columns)` is valid PostgreSQL syntax; both PostgreSQL 16 and 17 accepted it in an isolated syntax test. The previous migration was not syntactically broken at that statement. Its comment claiming table-level REVOKE leaves column grants behind was incorrect.

The migration now uses one explicit statement:

```sql
revoke all privileges on table public.divisions from public, anon, authenticated;
grant select on public.divisions to authenticated;
```

PostgreSQL [documents that table revocations remove the corresponding column privileges](https://www.postgresql.org/docs/17/sql-revoke.html). Removing the redundant dynamic column-list block retains its security effect and avoids unnecessary generated SQL. Regression fixtures grant SELECT, INSERT, UPDATE and REFERENCES on columns, including grant options, before reconciliation; the tests confirm those direct column ACLs and write privileges are gone afterward. Authenticated SELECT remains protected by the unchanged Admin RLS policies.

## Definer helper owner and execution

PostgreSQL [preserves existing function ownership and permissions during CREATE OR REPLACE](https://www.postgresql.org/docs/17/sql-createfunction.html). Relying on the migration caller alone therefore did not establish a safe existing owner or remove surplus grants.

The migration now explicitly assigns `can_read_organizational_structure()` to the trusted database-maintenance role `postgres`, revokes existing non-owner execution grants (including PUBLIC/default/custom grants), and grants EXECUTE only to `authenticated`, without grant option. A final ACL check rejects unexpected surviving grants. Both the invoker RPC and authenticated RLS expressions require this grant; the helper itself checks active Admin authorization and exposes only a caller-specific boolean.

The migration refuses to proceed if `anon` or `authenticated` is a member of `postgres`. Its failure is transactional. The helper still has an empty search path, fully qualified references, no parameters, no dynamic SQL and no writes. The owner is a privileged maintenance role, not a new least-privilege database role; the function's fixed narrow body is the boundary for its Auth read access. Existing shared authorization helpers and employee-directory RLS are unchanged.

## Validation

`node supabase/tests/organization_migrations.mjs` defaults to the locally installed `postgres:17-alpine`, matching the repository configuration. Set `HAWKIM_ORG_TEST_IMAGE=postgres:16-alpine` to repeat the compatibility tests. Images are not downloaded implicitly, ports are not published, and the runner removes its owned disposable container.

Both PostgreSQL 17 and 16 pass:

- The **complete migration**, followed by replay, against fresh, manually initialized and legacy schemas.
- Existing organizational records/metadata, employee records, permissions, assignments, table identity, live RESTRICT FK identity and RPC identity remain intact.
- Direct column-grant removal, minimum helper execution grants, trusted owner and fixed search path. The manual fixture deliberately starts with an authenticated-owned helper and an extra execution grantee.
- Existing hierarchy, authorization, privacy, empty-state, soft-delete and refetch SQL regression tests.
- A deliberate exception after the migration's final statement in fresh and manually initialized databases: catalog snapshots of relations, columns/ACLs, constraints, policies and functions/owners match the pre-migration snapshots after rollback.
- Unexpected FK/overload rejection, isolated snapshot-contract verification, and atomic refusal when an API role can assume the helper owner.

Every migration and replay uses `psql --single-transaction -v ON_ERROR_STOP=1`. The SQL file intentionally has no internal COMMIT, so the migration runner retains transaction ownership. Node syntax checks and `git diff --check` also pass. Frontend code was unchanged in this follow-up, so frontend tests/build were not repeated.

The harness uses the actual repository people/roles/profile migrations and a minimal local Supabase Auth stand-in. It does not replay the full SOP/storage chain or prove live JWT/session behavior.

## Remaining manual actions and risks

- Apply only through the normal reviewed migration process, atomically. For a direct psql invocation, use `--single-transaction -v ON_ERROR_STOP=1`; in SQL Editor wrap the entire migration in BEGIN/COMMIT. No production execution was performed here.
- The migration account must be permitted to replace the existing function, assign its owner to `postgres`, read the needed Auth fields as that owner and manage its grants. Compatible Supabase deployments normally run this as `postgres`. If a custom deployment uses a different trusted maintenance role, review that ownership choice before rollout rather than substituting an API role.
- Unexpected delegated EXECUTE grant chains may make REVOKE fail under its default RESTRICT behavior. That aborts the transaction for owner review; the migration does not cascade through grants silently.
- Existing known legacy SET NULL FKs are tightened to RESTRICT as before; compatible live RESTRICT FKs are untouched. DDL and index/constraint work can take locks, so use the normal deployment window.
- Preserve the prior migration-history reconciliation decision. This follow-up neither modifies the remote ledger nor marks migrations as applied. It accepts the owner's schema/RLS inspection and does not request that it be repeated.
