/**
 * The single activation switch for the Riyadh working-day deadline policy
 * (2 working days to respond; optional 1–30 working days to review; Sunday to Thursday; Asia/Riyadh).
 *
 * ACTIVE. New review requests get a fixed response deadline and a review duration in working days,
 * set by the server (supabase/migrations/20261101120100_internal_review_working_days.sql). Requests
 * sent before that migration keep the deadlines they were saved with.
 *
 * It depends on the database: the frontend reads the deadline_policy column only while this is true,
 * so the migrations must be applied first. To roll back, set it to false before running
 * supabase/scripts/rollback_working_day_deadlines.sql. Nothing else changes it: no environment
 * variable and no automatic detection.
 */
export const WORKING_DAY_DEADLINES_ACTIVE: boolean = true
