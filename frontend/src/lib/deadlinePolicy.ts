/**
 * The single activation switch for the Riyadh working-day deadline policy
 * (2 working days to respond; optional 1–30 working days to review; Sunday to Thursday; Asia/Riyadh).
 *
 * PENDING ACTIVATION. While false, new review requests follow the approved backend
 * (supabase/migrations/20261026150000_internal_review.sql): the author picks an optional response
 * due date (today or later; tomorrow or later from 16:00) and an optional review duration of
 * 1–30 calendar days, and the UI shows the deadlines the database saved.
 *
 * Set it to true ONLY in the same approved change that applies the two migrations in
 * supabase/proposals/ (see supabase/proposals/REVIEW_NOTES.md). Nothing else turns it on:
 * no environment variable and no automatic detection. While it is false the frontend never
 * reads the deadline_policy column, which exists only after that migration.
 */
export const WORKING_DAY_DEADLINES_ACTIVE: boolean = false
