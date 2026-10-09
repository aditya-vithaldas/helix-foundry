// Pure calculation helpers. UTC, Monday-start calendar weeks; the current
// partial week is never compared with a complete week.
export function showcaseWindow(now: Date) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - (end.getUTCDay() + 6) % 7);
  const before = (days: number) => new Date(end.getTime() - days * 86400000).toISOString().slice(0, 10);
  return {
    weekStart: before(7), weekEnd: end.toISOString().slice(0, 10),
    previousStart: before(14), baselineStart: before(35),
  };
}
// A source that stopped syncing part-way through last week would otherwise
// read as a sharp drop. Require records on the week's final day or later.
// Very sparse data is skipped too; it can't support a 10% comparison anyway.
export function coversWeek(lastDate: string, window: ReturnType<typeof showcaseWindow>) {
  const lastDay = new Date(window.weekEnd + "T00:00:00Z");
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  return lastDate.slice(0, 10) >= lastDay.toISOString().slice(0, 10);
}
export function relativeChange(current: number, previous: number): number | null {
  return previous === 0 ? null : (current - previous) / Math.abs(previous) * 100;
}
export function measureChange(current: number, previous: number, baseline: number | null) {
  const delta = current - previous;
  const changePercent = relativeChange(current, previous);
  const baselinePercent = baseline === null ? null : relativeChange(current, baseline);
  // A zero denominator has no percentage; a first non-zero result is still
  // worth showing. "Meaningful" is a transparent 10% heuristic, not a
  // statistical significance or causal claim.
  const notable = delta !== 0 && (previous === 0 || Math.abs(changePercent!) >= 10);
  return { delta, changePercent, baselinePercent, notable,
    score: previous === 0 ? 100 : Math.min(1000, Math.abs(changePercent!)) };
}
