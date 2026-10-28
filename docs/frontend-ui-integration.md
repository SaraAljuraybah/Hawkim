# Frontend UI update: integration limits

These changes use the current React prototype and its existing workflow transitions. No live database,
RPC, Supabase service, authentication, assignment, cancellation, or approval rules were changed.
The backend follow-up now includes an unapplied standalone SQL helper migration and updated input
validation; integration remains blocked on the canonical schema and Supabase Auth mapping.

## Safe frontend behavior

- My SOPs uses home-department ownership, with presentation categories only. Approved remains
  distinguishable from Published through the existing status badge.
- My Reviews separates incoming internal requests, accepted work, and closed history. Legacy queued
  reviews remain accessible with an explicit waiting label. Approvals remain on the existing route.
- The existing review actions moved to the Reviewers header, including the first request. Their
  handlers, guards, disabled states, approval tooltips, and version modes remain intact.
- Generated SOP codes remain in data, routes, notification identities, and internal relationships.
  Application labels, accessible names, page/preview titles, and application download names use titles.
  Uploaded document bytes and original stored metadata are unchanged. Native PDF controls and
  opening the original file URL can still use a URL-derived name; guaranteed download names there
  require a file endpoint with an appropriate Content-Disposition or a controlled PDF viewer.

## Fixed response period

The Submit for Review dialog calculates the second working **date after** the request's date in
`Asia/Riyadh`. The send date is not counted. Friday and Saturday are excluded; no holiday calendar
is configured. For example, Thursday 29 October 2026 produces Monday 2 November 2026. The field is
read-only, refreshes while open, and is recalculated at confirmation. A nonempty YYYY-MM-DD value
is passed through the existing responseDueDate contract in every dialog mode.

This is frontend enforcement. The existing transition validators still accept other optional dates.
The existing requestDeadline/endOfLocalDay/withdrawal machinery interprets a stored date at the
browser's **local** 23:59:59.999; it has not been migrated to a Riyadh instant. Thus non-Riyadh
clients are not guaranteed the same expiration instant. A backend implementation must calculate
and enforce the policy from a trusted request timestamp, preserve the Riyadh zone, store a precise
deadline, and use it consistently for withdrawal, reminders, and display. Old saved allocations
must not be recalculated. Browser refreshes are not a substitute for server enforcement.

## Review duration

The optional 1–30 day duration starts on acceptance and still counts **calendar days**, including
weekends. The dialog explicitly says so; it does not claim working-day review duration is complete.
Weekend exclusion requires an aligned acceptance-time calculation in the workflow service/backend,
then consumption of its saved deadline by all clients. The two-day response period is separate.

## Comments

The editor and current in-memory submission/resubmission transitions now share a 1000-character
limit, with a live counter and rejection above 1000 trimmed UTF-16 units. The standalone SQL note
validator matches that normalization and length, including astral Unicode. It has been executed in
an isolated local PostgreSQL 17 database, but is not yet attached to an assignment RPC or table.
Actual Supabase persistence of comments therefore remains unverified and blocked on the schema.
The original 20261026150000_internal_review.sql is absent. The new
20261029000000_review_deadline_helpers.sql only creates independent helpers and alters no records.

## Department and Division

Only eligible home-department reviewers can be submitted in this flow. The department therefore
stays locked and visible. Department.divisionId is a single configured organizational grouping key
used by the existing routing logic, not a catalogue of divisions inside a department. Its actual
value, or an explicit unconfigured state, is displayed read-only. These two fields do not offer
searchable choices; only the reviewer field has valid multiple choices and uses PeoplePicker search.

Cross-department selection needs a separately authorized routing contract, eligible department and
reviewer data, version-scoped assignments and access, and validated external-review evidence for
approval. A selectable Division field needs an agreed division data source and relationship first.
No invented names, unsupported selections, or simulated successful external submissions were added.

## Already present or corrected after verification

Required-title submit validation, the Reviewers concept, and the distinct initial/add/new-version
review actions already existed. The actual checkout used a 150-character upload title limit and
placed Reviewers before SOP History, so the requested 50-character frontend limit and section order
were corrected. Existing saved titles are not rewritten. Preview title and version remain visible.
