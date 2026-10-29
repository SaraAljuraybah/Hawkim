# Frontend integration status — local prototype

Updated for `feat/frontend-ui-enhancements`, continuing saved commit `a11246b`.
This report replaces earlier integration assumptions. The current delivery is frontend-only and works without Supabase credentials.

## Implemented frontend

- My SOPs retains New/In Progress/Completed categories, title search, filters, Main Author/Co-Author indicators, Grid/List views and saved view preference.
- My Reviews retains Incoming Requests/Active Reviews/Completed Reviews and a separate Approvals area. Expired pending requests leave Incoming; closed decisions remain in history.
- Workflow sections, Add Reviewers action placement, descriptions, hidden serial numbers, the 50-character title limit, 1000-character comments and searchable eligible reviewer selection remain in place.
- The existing local Author → parallel Reviewers → separate Author approval submission → configured Approver → publication transitions remain operational. Existing compliance requirements and approval date restrictions remain intact.
- Only the Author may create reviewer assignments. Legacy handoffs may reuse an eligible, non-cancelled existing assignment without a new reviewer or deadline. Historical decisions, comments and version access remain preserved.

## Deadline policy

New internal requests use `riyadh-working-days-v1`:

- Response due date: the second working date after the request's date in `Asia/Riyadh`. The request date is excluded; Friday and Saturday are excluded. Thursday 29 October 2026 therefore expires Monday 2 November 2026.
- Review duration: optional 1–30 working days, counted after each reviewer's acceptance date. Acceptance day and Friday/Saturday do not count. The response period is separate.
- The end of a newly allocated date is 23:59:59.999 in Riyadh (20:59:59.999Z). Precise saved timestamps govern countdowns, reminders and local withdrawal.
- New legacy date allocations and resubmissions also save a precise Riyadh deadline. Saved date-only legacy records retain their compatibility interpretation. No historical allocation is migrated or recalculated.
- Original allocation, saved deadline and real remaining time are distinct. Historical/closed views keep dates without active clocks or overdue reminders, including the People section.
- Approval dates retain their existing browser-local tomorrow-through-30-days rules. Review changes do not alter them.
- No public-holiday calendar is configured. Browser timers and clocks provide a prototype only; no server scheduled job exists.

## Runtime and identity

`FRONTEND_PROTOTYPE` is fixed to true. Environment credentials cannot enable the experimental adapter. Demo sign-in selects an active configured local identity; a non-empty demo password is not authenticated or sent anywhere.

The shared in-memory workspace permits an Author/Reviewer/Approver demonstration across sign-ins. SOP context exposes only the current identity's authorized documents and assigned versions. Sign-out exposes no SOPs. Stale callbacks and old asynchronous integration responses are rejected or discarded. This frontend behavior is not a substitute for future server authorization.

Experimental service modules are not imported by active prototype paths. Local sample/object document URLs remain available; remote storage-only files remain unavailable. No new storage or authentication architecture was introduced.

## Cross-department and Division UI: partial

The initial department is the SOP's home department. The existing division identifier is displayed read-only, with an explicit unconfigured state. Existing saved plans remain visible. Reviewers cannot create external assignments, choose departments, skip required external work or route to Quality.

The Author can proceed using the existing explicit “no external reviews required” approval confirmation when no required external gate exists. A required external gate still blocks approval until valid current-version/current-round evidence is complete.

New external selection remains pending. The unresolved contract is concrete:

1. The approved Division catalogue and mapping of departments to those divisions; a free-text `divisionId` is not a Division catalogue.
2. The Author-controlled external round/assignment lifecycle and how version/round-scoped completion, cancellation and feedback map into the existing `externalReviewGate` evidence contract.
3. Which existing legacy department plans may be continued without transferring reviewer-assignment authority back to a Reviewer.

The known requirements—optional Author-controlled routing and independent eligible reviewers—are preserved. No organizational relationships or successful external submissions are invented.

## Deferred and backend-dependent

SOP Preview item 3.6 remains postponed and was not implemented. Live authentication, database/RLS/RPC authorization, durable files/history, server deadlines, scheduled withdrawal and email delivery require an approved backend contract and separate integration work. Tests for experimental services use mocks; they do not validate a live project.

## Before a frontend Pull Request

The branch includes unapproved database and integration changes in earlier commit `a3237e6`. See `backend-integration-status.ar.md` for the inventory. Do not merge or cherry-pick the whole WIP history as a frontend-only change.

After explicit approval, prepare a reviewed frontend-only changeset against the agreed integration base, manually separating mixed provider/auth/file/type changes and excluding experimental SQL/service changes. Preserve this branch and all backend files. Re-run the complete frontend checks on that candidate. No separation, branch/worktree creation, history rewrite, commit, push or merge has been performed in this continuation.
