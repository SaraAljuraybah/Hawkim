-- Step 4 of the 20261112140000 tests (see admins_without_department_before.sql): a request sent without a
-- position, kept, so the rollback is tested with such a row present. Disposable LOCAL database only.
select public.submit_access_request('AW Kept Pharma', 'Kept Applicant', null, 'aw-kept@test.invalid', '+966500000005', 5, null, repeat('9', 64));
