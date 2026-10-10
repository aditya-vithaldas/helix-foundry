# Business-aware Home — concept

Standalone HTML; open index.html directly in a browser. All finding and chart values are illustrative. No live scan or backend requests.

The complete Home composition includes the Ask/search box, Some things we noticed, key metrics and trend/breakdown charts, workspace health, recent activity and ontology. The existing Home component patterns from home.tsx, metrics.tsx and home.css guide the lower sections; these are representative sample charts, not fetched live results.

Three compact findings appear side by side on desktop and one at a time in a manual phone carousel. Use subtle labelled icons for Positive, Warning and Issue. Dismiss a finding or undo dismissal. Important tagging is removed. Details contain explanations, evidence and limitations. No generic totals-are-steady callout and no business-understanding block. No automatic rotation. Dismissals apply to the current preview session only.

Project paper/olive theme, semantic tokens and bold text emphasis are retained. Demo controls illustrate major scan stages and failure without discarding earlier findings.

Validated JavaScript syntax, complete Home sections, three visible desktop cards, one visible phone card at 390px, no document overflow, carousel navigation, dismiss/undo, evidence disclosure, Ask preview submission, failure/retry and theme controls. This is a design proposal, not a deployed implementation or detection engine. No main merge.

Finding secondary text is limited to 3–4 words at 11px. Details is a subtle muted text disclosure with a small chevron and no separator line. Updated desktop and 390px mobile previews verify the compact layout; mobile capture is a 390px iframe viewport.

ChatGPT-only hands-free voice preview: a secondary orb follows the existing input on Home. In normal Analyst chat it is centered above the composer, outside its border, and glows blue throughout the active Live session to signal a continuing conversation. Activating it simulates a question; pausing automatically submits into the ordinary conversation. It simulates a response, listens again and completes a second follow-up without another click. The same chat composer remains available for typing. No floating live panel or per-finding Talk actions. Demo provider selector hides both orbs for Claude and Local. The microphone stays off; all transcripts and responses are scripted. There is no audio playback, ChatGPT connection or production voice implementation.

Verified two automatic questions and two replies, continued listening, stopping voice, provider gating, typed drafts and a 390px phone layout without document overflow. Normal chat layout follows chat.tsx and analyst.css. hands-free-desktop.jpg and hands-free-mobile.jpg show the conversation/composer. Mobile capture uses a 390px iframe viewport. Open index.html#hands-free to replay the scripted flow; this deep link is only a prototype shortcut, not an instruction to capture a real microphone on page load.

Production prerequisite: GPT-Live (gpt-live-1) with real tool calling/delegation, as specified in upstream issue #54. The scripted UX simulation is not the production implementation. Verified above-composer placement and active blue glow on desktop and phone.
