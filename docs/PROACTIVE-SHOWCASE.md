# Proactive Showcase

Adds a Showcase entry to the sidebar at /showcase and an authenticated
GET /api/v1/workspaces/:w/showcase endpoint.

The existing worker checks the workspace after imports and pipelines while
idle, so the briefing updates even when the page is closed. The page checks
every 20 seconds while open. Results are stored in the existing resource store.
No new database, provider call or dependency is required.

## Comparisons

- Last completed Monday–Sunday calendar week, in UTC.
- Previous completed week, with identical exclusive end boundaries.
- Weekly average of the four preceding complete weeks, when dated history
  reaches the start of that period.
- At most three highlights, ranked by absolute percentage movement.
- At least a 10% movement, or a non-zero value following zero; zero
  denominators never produce fabricated percentages.

This is a descriptive heuristic, not statistical significance or proof of a
cause. Sparse history is omitted conservatively. Observed record dates cannot
prove complete source ingestion, so a dataset is only compared when it has
records on the comparison week's last day or later. Otherwise a source that
stopped syncing mid-week would read as a sharp drop; the page lists such
datasets with their latest record date instead. A quiet interval within supported history
counts as zero for sums/counts; missing averages remain unavailable.

The first version uses temporal metric specs already selected for Home,
supplemented by its computed fallback specs. Standing totals and categorical
breakdowns are not compared as weekly additions. Up to eight distinct metric
definitions are considered. Entity attribution and configurable thresholds
are possible follow-up changes.

## Refresh and evidence

The cache key includes dataset versions, metric definitions and calendar week.
Each query cites its snapshot. Refresh detects changes during analysis and
preserves the previous successful result, retrying after one minute.
A metric whose query fails is logged and counted as failed; the others are
still reported, and the report is retried after five minutes. When every
metric fails, the previous successful result is kept as for any other failure.
Concurrent refreshes of a workspace within one process are coalesced.

Cards expose SQL, snapshot references, current/prior/baseline values, source
data links and an Explore with Analyst action. The analyst receives the exact
period, dataset and snapshot reference and is asked to disclose if current
data has changed. It does not assume the older snapshot remains active.

The feature executes validated metric queries without sending rows to an AI
provider. Explanations are deterministic; analyst exploration uses Helix's
existing provider configuration when the user invokes it.

## Tests

`tests/showcase.test.ts` runs with `pnpm test` (and so in CI). It covers the
week windows and thresholds, and runs the weekly SQL on the real DuckDB
engine against an in-memory store: findings and caching, a stalled source,
short history, partial and total query failures, and snapshot changes during
analysis.

For end-to-end validation in the browser: ingest dated data spanning six
weeks, visit /showcase, and ingest a new version with changed historical
records. Confirm the card values and snapshot evidence update. Check
navigation, Analyst exploration and a narrow viewport.
