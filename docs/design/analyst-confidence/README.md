# Analyst confidence trace — design concept

Standalone, dependency-free HTML prototype. Open analyst-concept.html in a browser. Sample numbers and timing are illustrative. This is a design artifact, not a deployed product change.

- Compact, dynamic preview: two to three major steps, expandable.
- Expansion contains four steps: understand the question, analyze orders, check results, write the answer. No tabs or separate calculation section.
- Query details appear only inside the expansion and are themselves collapsed by default.
- Highlight the primary answer and important quantities with restrained mint emphasis.
- Show a useful chart and focused table with visible measures.
- Timing hints in production must come from measured similar runs; otherwise show phase and elapsed time. The preview's 10–20 seconds is not a real service promise.
- Reuse Helix tokens and docs/DESIGN.md conventions, including keyboard focus, dark mode and mobile wrapping.

Prototype controls replay activity or show long-wait and failure examples. They make no backend requests. Save as view only toggles a local preview state.

Screenshots: desktop.png, mobile.png and expanded.png. All contain illustrative design data.
