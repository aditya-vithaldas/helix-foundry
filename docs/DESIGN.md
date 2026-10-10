# Helix design standards

These standards are reconstructed from the current product styles, shell and
component contracts. They cover the workspace and its onboarding flow. The
implementation is the source of truth; reuse its tokens and components.

## Source map

| Source | Responsibility |
| --- | --- |
| [`workspace.css`](../apps/web/src/workspace.css) | Workspace tokens, themes, shell and base typography |
| [`kit/index.ts`](../apps/web/src/kit/index.ts) and [`kit.css`](../apps/web/src/kit/kit.css) | Shared controls, page containers, tables, panels and status components |
| [`minimal.css`](../apps/web/src/minimal.css) | Onboarding and earlier pages, including setup widths and responsive rules |
| [`ontology-scene.css`](../apps/web/src/ontology-scene.css) | Setup illustration, mint activity marks and stage feeds |
| [`style.css`](../apps/web/src/style.css) | Original base styles; later imports provide workspace and onboarding overrides |

`main.tsx` imports these layers in order. Read the final rule and its scope
before copying a value from an earlier stylesheet.

## Visual language

- Warm paper surfaces, olive ink, fine borders and restrained mint accents.
- Georgia display headings; Inter/system sans-serif for controls and body text.
- Calm layouts with generous space, short labels and plain explanations.
- Use icons with text; reserve strong color for activity, selection and status.

The workspace tokens live in `apps/web/src/workspace.css`: `--hf-*` colors,
type sizes, spacing, radii and motion. Workspace components live in
`apps/web/src/kit`. Onboarding sits outside `.hf-app` and uses `minimal.css`
for its light paper theme, 30px serif headings, 14px body text, 12–13px
supporting text, a 760px centered page and 22px mobile gutters. Its activity
scene and stage marks live in `ontology-scene.css`. Preserve that theme when
adding setup UI; workspace dark-mode tokens do not apply to onboarding.

## Progress and feedback

- Drive stages and completion from server state. Show skipped stages as
  “Not needed”. Label the overall work percentage as approximate: use fixed
  rough duration shares (25% records, 70% relationships, 5% final checks),
  driven by confirmed counts. Reserve 100% for server-confirmed readiness.
  For builds without relationships, records occupy 95% of the work.
- Show measured progress for known work, with compact counts such as
  `Records: 233K / 4.3M` and `Relationships: 80K / ~748.9K`. Keep both counts visible;
  all records being written does not mean relationships and publication are done.
- Keep the stage and timing together. Use supporting text, for example
  `9:55 elapsed / Remaining: relationships and final checks`.
- Keep counts, elapsed time and remaining time in stable positions. Retain
  the last known counts and remaining phase between polls; do not repeatedly
  add and remove explanation blocks or use a continuously moving bar for
  measured work.
- Explain long waits without promising a completion time. Distinguish a
  lost status connection from a failed operation, and preserve the last state.
- Keep existing Stop and Retry actions. Do not offer Stop once publication
  has begun; the server finishes publication atomically.
- Announce stage changes politely; do not announce a ticking timer every second.
- Respect reduced motion, provide visible keyboard focus, use semantic lists
  and progress roles, and do not rely on color alone to convey status.
- At narrow widths stack stages, wrap text, and avoid horizontal overflow.

Show remaining work by phase rather than extrapolating record speed into
relationship speed: “Remaining: records, relationships and final checks”, then
“Remaining: relationships and final checks”, then “Remaining: final checks”.
This keeps the text stable without promising a duration that changes with
processing rates. Display connection interruptions separately. Retain confirmed
counts and fixed totals through missing or out-of-order polls, and reset them
for a new publication generation. A failed operation must remain visible even
if its inputs change. Only server completion means ready.

## Workspace foundations

Use semantic `--hf-*` tokens in workspace styles. The light palette below is a
reference for recognizing the product; dark mode overrides these same roles.

| Role | Token | Existing light value |
| --- | --- | --- |
| Paper background | `--hf-bg` | `#f8f7f3` |
| Raised panel | `--hf-raised` | `#fdfcf9` |
| Sunken surface | `--hf-sunken` | `#f0efe9` |
| Body text | `--hf-text` | `#292a26` |
| Secondary text | `--hf-text-2` | `#4f534a` |
| Supporting text | `--hf-muted` | `#65675e` |
| Divider | `--hf-border` | `#e4e2da` |
| Primary action ink | `--hf-ink` | `#343932` |
| Mint accent | `--hf-accent` | `#36b98a` |
| Accent text | `--hf-accent-text` | `#2d6a4b` |
| Keyboard focus | `--hf-focus` | `#2a8f69` |

Keep fills and text roles distinct: the brighter mint is an accent, while the
darker accent text is for labels. `--hf-faint` is for icons and decoration.
Do not replace semantic tokens with light-only hex colors in workspace pages.
The workspace supports system dark mode and explicit theme selection; setup
retains its light paper theme outside `.hf-app`.

The existing type scale is 11, 12, 13, 14, 16, 20, 26 and 34px. Use the matching
`--hf-text-*` role. Body and controls use `--hf-font-sans`; display headings use
`--hf-font-display`; identifiers and code use `--hf-font-mono`. The workspace
page heading is 26px, becoming 23px below its 800px breakpoint. Use tabular
numbers for metrics, counts and timers.

Spacing tokens cover 4, 8, 12, 16, 24, 32, 40, 48 and 64px. Existing radii are
6, 8, 12 and 16px, plus a pill radius. Prefer fine borders and `--hf-shadow-1`
for ordinary controls; reserve larger shadows for elevated overlays. Default
control transitions use `--hf-duration` (160ms) and `--hf-ease`.

## Page and component patterns

| Need | Existing component and convention |
| --- | --- |
| Page layout | `Page` with `narrow`, `default`, `wide` or `full` width; `PageHeader` for title, subtitle, metadata, actions and optional tabs |
| Navigation within a page | `Breadcrumbs` for hierarchy; `Tabs` and `TabPanel` for peer views; preserve selected state through existing URL helpers |
| Actions | `Button`, `ButtonLink`, `ButtonAnchor` and `IconButton`; choose the element according to whether it performs an action or navigates |
| Data inspection | `DataGrid`, `Toolbar`, `SearchInput`, `FilterSelect` and `FilterBar`; keep filtering and row actions consistent |
| Grouped content | `Section`, `Panel`, `SplitView` and `KeyValue`; preserve the hierarchy between page, section and record detail |
| Metrics | `StatCard`, shared number formatting and chart color tokens |
| Source identity | `SourceLogo` and `SourceStack`, using existing connector labels and logos |
| State and feedback | `StatusBadge`, `StatusDot`, `EmptyState`, `Skeleton` and `SkeletonText` |
| Overlays | `Dialog`, `ConfirmDialog` and `DropdownMenu`; use the shared focus, close and keyboard behavior |

Buttons have five existing variants: primary, secondary, ghost, accent and
danger. Their small, medium and large heights are 28, 34 and 40px. Use primary
for the main action, secondary for regular alternatives, ghost for quieter
actions and danger for destructive operations. The component's `pending`
state disables repeated submission and exposes `aria-busy`. Icon-only buttons
require a meaningful label.

Status is shared language: queued and draft are neutral; running and syncing
use info; healthy and succeeded use success; stale and review use warning;
failed uses danger; paused and canceled are neutral. Use the existing
`toStatus`, `statusLabel` and `statusTone` mapping rather than assigning new
colors or labels independently.

Charts use `--hf-chart-1` through `--hf-chart-6` in their existing order. Labels,
legends and accessible values must explain the data without relying on color.
Use shared formatting for numbers, dates, currencies and relative time.

## Responsive and accessible behavior

The workspace shell has a 236px sidebar and a 60px collapsed variant. Use its
existing responsive rules rather than giving a new page its own navigation
layout. Page-header actions wrap beneath the title on smaller screens.
Preserve readable labels, wrap supporting copy, and contain wide tables within
their data view. Check both the normal viewport and a 390px phone viewport.

Workspace focus uses a 2px semantic focus outline; setup has its own visible
focus treatment. Use real buttons, links, headings, labeled controls and table
semantics. Announce meaningful status changes and errors, retain focus when
opening or closing overlays, and hide decorative icons from assistive
technology. Respect `prefers-reduced-motion` for both the shell and setup.

Before delivering a UI change, inspect its final style scope, pending and
failure states, keyboard labels, mobile wrapping and reduced-motion behavior.
Preserve connected sources and user data when improving feedback or recovery.
