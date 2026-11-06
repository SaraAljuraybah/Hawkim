# delete-sop (deletes SOPs and versions together with their files)

The browser calls this function (with the signed-in user's token) to:

- `{ "action": "delete-sop", "sopId", "reason" }`: the main author permanently deletes an SOP
  (`public.delete_sop`), then its files are removed from the `sop-files` bucket;
- `{ "action": "delete-version", "sopId", "version" }`: the main author or uploader deletes one
  version (`public.delete_sop_version`; the row is only marked deleted), then its file is removed.

The database functions check every rule and can only be called by `service_role`, so the browser
can't change rows without the files going too. If removing a file fails after the rows changed,
the function logs it and still reports success (nobody can open a file without its version).

## Setup (once, in this order)

1. **Deploy the function:** Dashboard → Edge Functions → **Deploy a new function** → **Via Editor**.
   Name it exactly `delete-sop`, replace the sample code with `index.ts`, then **Deploy function**.
   Leave **Verify JWT** on. If the signed-in app gets `401 Invalid JWT`, the project uses the new
   JWT signing keys: turn it off; the function still checks the token itself.
   No secrets to add: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.
2. **Apply the migrations** in the SQL Editor: `20261106120000_delete_sop.sql`, then
   `20261106120100_delete_sop_version_files.sql`.
3. **Deploy the frontend** straight away: between steps 2 and 3, the old frontend can't delete versions.

## Logs

Edge Functions → delete-sop → **Logs**:

- `delete-sop: SOP deleted {...}`: the SOP code, title, id, the user's id and the justification
  (the only record of a deletion);
- `delete-sop: … rows changed, files kept: …`: the files to remove by hand (Storage → sop-files);
- `delete-sop: … failed: …`: an unexpected database error.

## Rollback

Roll back the frontend first, then run `supabase/scripts/rollback_delete_sop_version_files.sql`
and `supabase/scripts/rollback_delete_sop.sql`, and delete the function. Deleted rows and files
can't be brought back.
