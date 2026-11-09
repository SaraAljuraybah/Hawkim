# Organizational Structure UI refinement

## Changes

- Kept the page heading and removed its description entirely.
- Removed the page's Refresh button/icon and its unused content entry. Data loads automatically when the page opens; API failures retain the Retry action.
- Moved Organizational Structure to the final Admin navigation position after Regulations, retaining its route, icon, active indicator and Admin guard.
- Organization now has a centered burgundy header with white text, rounded corners, subtle shadow and no decorative icon.
- Divisions now have warm beige headers with burgundy text, common minimum height/padding, rounded borders and no icons. Department cards remain white and keep their disclosure chevrons.
- Expanded employee rows use the existing off-white token, gentle separators and spacing. Names and circular-avatar initials use the same `text-maroon` token; avatars retain their beige background.
- Replaced chart permission pills with small, normal-weight gray text. Stored job positions remain separate from application permissions, with accessible labels distinguishing each. All permissions are retained; roleless people retain the Employee label. Shared Users-page badges are unchanged.
- Adjusted loading placeholders to four desktop cards without a fixed-width root skeleton that could overflow a narrow viewport.

## Width and connector behavior

The chart no longer contains fixed 320px branches, a max-content wrapper, or horizontal scrolling. Container queries measure the width actually available after the sidebar and page padding. Grid tracks use `minmax(0, 1fr)`; text and employee content can wrap, including long unbroken names.

At 48rem of available chart width, up to four branches fit in one row. At 30rem, the layout uses up to two columns; below that it stacks. The trade-off on narrower desktop/tablet screens is additional vertical space rather than compressed text or sideways scrolling. An extra unassigned branch also wraps safely.

Four desktop branches retain the centered tree connector. Wrapped rows use an outside vertical rail with horizontal connections above the cards. Department connectors stay beside the cards and move naturally with their expanded lists. No ancestor overflow is hidden to clip the layout. Only employee lists scroll vertically, up to their existing height limit.

## Files changed in this follow-up

- `frontend/src/components/admin/OrganizationChart.tsx`
- `frontend/src/components/admin/organizationChart.css`
- `frontend/src/pages/admin/OrganizationalStructurePage.tsx`
- `frontend/src/content/admin.en.ts`
- `frontend/src/content/organization.en.ts`
- `frontend/src/pages/admin/organizationalStructure.test.tsx`
- `frontend/src/pages/admin/organizationalStructureLoading.test.tsx` (automatic loading/reopening regression)
- `frontend/src/services/organization.test.ts` (division-label pass-through regression)
- `frontend/scripts/check-organization-layout.mjs`
- `supabase/proposals/rename_organizational_divisions.sql` (proposal only)
- `docs/organizational-structure.md` and this report

Services, routing, guards, database schema, RLS, migrations and SOP workflows were unchanged in this follow-up. Existing teammate changes were retained.

## Validation

- Focused component, loading/refetch, service and routing tests: **5 files / 38 tests passed**, including automatic loading/reopening, Retry, absence of Refresh, and unchanged RPC division labels.
- TypeScript project checks and production build: passed via `npm run build`.
- Lint: passed via `npm run lint`.
- Native headless Chrome check: passed all 48 width/state combinations (three chart cases × eight widths × collapsed/expanded). Widths: 320, 375, 768, 1024, 1280, 1366, 1440 and 1920px. Cases: configured divisions, direct departments without divisions, and an extra unassigned branch. Tests check page/chart/visible-descendant overflow, four desktop columns, equal desktop header heights, matching initials/name colors, multiple open departments and mouse/keyboard toggles. Desktop and mobile screenshots were visually inspected.

Run the repeatable browser check from `frontend` with `node scripts/check-organization-layout.mjs`. It uses installed Chrome/Edge (or `HAWKIM_TEST_BROWSER`) and actual chart/CSS with local test fixtures. It never calls Supabase or replaces production data. Screenshots are written to a temporary directory, or an optional output-directory argument. This is component-level layout validation using the Admin shell dimensions, not a signed-in production screenshot.

## Proposed division rename: approval and deployment

The exact, guarded SQL is in [rename_organizational_divisions.sql](../supabase/proposals/rename_organizational_divisions.sql), outside the migrations directory. It has **not been executed**. The requested changes are:

| Stable division ID | Expected current name | Approved new name |
| --- | --- | --- |
| `rnd` | R&D Division | Clinical Research & Development |
| `governance_quality_compliance` | Governance, Quality & Compliance | Quality & Compliance |

After approval, an authorized owner should run the complete file as one transaction in Supabase SQL Editor. It locks those two rows, refuses missing/unexpected names, changes only their `name` fields and returns the final labels. If already renamed to the approved names, rerunning makes no changes. Any exception aborts both renames; resolve it before retrying. IDs, department assignments, all department names (including Legal & Governance), and other division names remain untouched.

Then reopen Organizational Structure to load the updated names automatically. Names continue to come directly from `get_organizational_structure`; there is no frontend ID-to-name override. Until the proposed data update is approved and applied, the current persisted names remain visible. Regression tests cover both requested stable IDs, their requested names and alternate returned names, confirming that the UI never overrides the RPC label. Legal & Governance is unchanged. This verifies frontend pass-through behavior, not the current live database labels.

No production SQL, commits, pushes or merges were performed.
