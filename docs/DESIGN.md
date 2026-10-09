# Helix design standards

These standards describe the existing interface and should guide additions.
The implementation is the source of truth; reuse its tokens and components.

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
  “Not needed”; never invent a completion percentage or ETA.
- Use an indeterminate activity bar when the amount of work is unknown.
  Keep the current stage, completed stages and elapsed time visible.
- Explain long waits without promising a completion time. Distinguish a
  lost status connection from a failed operation, and preserve the last state.
- Keep existing Stop and Retry actions. Do not offer Stop once publication
  has begun; the server finishes publication atomically.
- Announce stage changes politely; do not announce a ticking timer every second.
- Respect reduced motion, provide visible keyboard focus, use semantic lists
  and progress roles, and do not rely on color alone to convey status.
- At narrow widths stack stages, wrap text, and avoid horizontal overflow.

`build-progress.tsx` applies these conventions to workspace setup. Its elapsed
time resumes from the server's creation timestamp after a page reload. The
existing onboarding query polls server status once a second during a build.
