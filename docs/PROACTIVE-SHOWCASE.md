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
prove complete source ingestion. A quiet interval within supported history
counts as zero for sums/counts; missing averages remain unavailable.

The first version uses temporal metric specs already selected for Home,
supplemented by its computed fallback specs. Standing totals and categorical
breakdowns are not compared as weekly additions. Up to eight distinct metric
definitions are considered. Entity attribution and configurable thresholds
are possible follow-up changes.

## Refresh and evidence

The cache key includes dataset versions, metric definitions and calendar week.
Each query cites its snapshot. Refresh detects changes during analysis and
preserves the previous successful result, retrying after one minute. Worker
and page calls are coalesced per store/workspace.

Cards expose SQL, snapshot references, current/prior/baseline values, source
data links and an Explore with Analyst action. The analyst receives the exact
period, dataset and snapshot reference and is asked to disclose if current
data has changed. It does not assume the older snapshot remains active.

The feature executes validated metric queries without sending rows to an AI
provider. Explanations are deterministic; analyst exploration uses Helix's
existing provider configuration when the user invokes it.

## Applying the patch

Prepared against HelixDB/helix-foundry commit
48a161a57a09d2691e0a8b0dca93189bb74aee0f.

From a checkout of that commit:

    git apply --check /path/to/helix-proactive.patch
    git apply /path/to/helix-proactive.patch

Use the existing AGENTS.md development workflow with Node 24 and pnpm 10.7.0.
Run pnpm typecheck, pnpm test and pnpm build before merging.
The dependency-free focused checks can also run with:

    node --experimental-vm-modules --test tests/showcase.standalone.mjs

For end-to-end validation after dependencies are available: start an isolated
test workspace, ingest dated data spanning six weeks, visit /showcase, and
ingest a new version with changed historical records. Confirm the card values
and snapshot evidence update; then disable the executor and confirm the last
successful briefing is retained. Check navigation, Analyst exploration and a
narrow viewport.

## Validation performed in the preparation environment

- Seven standalone regression checks passed against the actual TypeScript
  calculation and refresh modules, with mocked store/query dependencies.
- Web, API and worker entry points bundled successfully with esbuild,
  resolving internal imports.
- Full dependency installation was blocked by registry DNS access.
- Full TypeScript checks, Vitest suite, DuckDB execution and browser validation
  therefore remain required in a working Helix development environment.
- No running Helix installation or upstream GitHub repository was modified.
