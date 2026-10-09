import { datasetTable, type MetricSpec, type Resource } from "../../../packages/shared/src/index.js";
import type { Showcase, ShowcaseFinding } from "../../../packages/shared/src/showcase.js";
import { compileMetric, computedSpecs, METRICS_ID, metricsDatasets, noun } from "./metrics.js";
import { queryDatasets } from "./datasets.js";
import { q, lit } from "./discovery.js";
import { digest } from "./security.js";
import { resource, transaction, type Store } from "./store.js";
import { measureChange, showcaseWindow } from "./showcase-calculations.js";

export const SHOWCASE_ID = "proactive_showcase";
const inflight = new WeakMap<Store, Map<string, Promise<Showcase>>>();
// All identifiers and filters pass the existing compiler's schema validation.
export function weeklySql(spec: MetricSpec, dataset: Resource, window: ReturnType<typeof showcaseWindow>) {
  if (!spec.timeColumn || "error" in compileMetric({ ...spec, kind: "kpi" }, dataset)) return undefined;
  const used = [spec.column, spec.timeColumn, spec.filter?.column].filter(Boolean);
  if (dataset.data.profile?.columns.some((c: any) => used.includes(c.name) && c.sensitive)) return undefined;
  const column = q(spec.column || "");
  const aggregate = spec.measure === "count" ? "count(*)"
    : spec.measure === "count_distinct" ? `count(DISTINCT ${column})`
    : `${spec.measure}(TRY_CAST(${column} AS DOUBLE))`;
  const scale = spec.scale === "cents" ? " / 100.0" : "";
  const value = (from: string, until: string) => {
    const expression = `${aggregate} FILTER (WHERE "__ts" >= TIMESTAMP ${lit(from)} AND "__ts" < TIMESTAMP ${lit(until)})${scale}`;
    return spec.measure === "avg" ? expression : `COALESCE(${expression}, 0)`;
  };
  // Compare four separate weekly aggregates; for averages and distinct
  // counts, dividing a pooled total by four would be wrong.
  const baselineWeeks = Array.from({length: 4}, (_, i) => {
    const day = new Date(window.baselineStart + "T00:00:00Z");
    day.setUTCDate(day.getUTCDate() + i * 7);
    const from = day.toISOString().slice(0, 10);
    day.setUTCDate(day.getUTCDate() + 7);
    return value(from, day.toISOString().slice(0, 10));
  });
  return `WITH b AS (SELECT *, CAST(${q(spec.timeColumn)} AS TIMESTAMP) AS "__ts" FROM ${q(datasetTable(dataset.id))}
    WHERE ${q(spec.timeColumn)} IS NOT NULL${spec.filter ? " AND lower(CAST(" + q(spec.filter.column) + " AS VARCHAR)) = lower(" + lit(spec.filter.value) + ")" : ""})
    SELECT ${value(window.weekStart, window.weekEnd)} AS current,
    ${value(window.previousStart, window.weekStart)} AS previous,
    (${baselineWeeks.join(" + ")}) / 4.0 AS baseline,
    CAST(min("__ts") AS VARCHAR) AS firstDate, CAST(max("__ts") AS VARCHAR) AS lastDate FROM b`;
}
const versions = (ds: Resource[]) => ds.map(d => [d.id, d.data.activeVersion]);
export function proactiveShowcase(store: Store, scope: string, now = new Date()): Promise<Showcase> {
  let calls = inflight.get(store);
  if (!calls) { calls = new Map(); inflight.set(store, calls); }
  if (!calls.has(scope)) calls.set(scope, refresh(store, scope, now).finally(() => calls!.delete(scope)));
  return calls.get(scope)!;
}
async function refresh(store: Store, scope: string, now: Date): Promise<Showcase> {
  const window = showcaseWindow(now);
  const datasets = await metricsDatasets(store, scope);
  const metrics = await store.get(scope, METRICS_ID);
  const specs: MetricSpec[] = [
    ...(metrics?.data.metrics || []).map((m: any) => m.spec),
    ...computedSpecs(datasets),
  ];
  const unique = new Map<string, MetricSpec>();
  for (const spec of specs) if (spec.timeColumn && spec.kind !== "breakdown") {
    const key = JSON.stringify([spec.datasetId, spec.measure, spec.column, spec.timeColumn, spec.filter, spec.scale]);
    if (!unique.has(key)) unique.set(key, spec);
  }
  const selected = [...unique.values()].slice(0, 8);
  const signature = digest(JSON.stringify([1, window, versions(datasets), selected]));
  const prior = await store.get(scope, SHOWCASE_ID);
  if (prior?.data.signature === signature && !prior.data.error) return prior.data as Showcase;
  // Back off failures without replacing the last successful snapshot.
  if (prior?.data.failedSignature === signature && prior.data.retryAt > now.getTime())
    return { ...(prior.data as Showcase), stale: true };
  const base: Showcase = { ...window, timezone: "UTC", signature, status: "empty", findings: [], measured: 0, skipped: 0 };
  try {
    const ranked: (ShowcaseFinding & {score: number})[] = [];
    for (const spec of selected) {
      const dataset = datasets.find(d => d.id === spec.datasetId);
      const sql = dataset && weeklySql(spec, dataset, window);
      if (!dataset || !sql) { base.skipped++; continue; }
      const result = await queryDatasets(store, scope, [dataset.id], sql, {limit: 1});
      if (result.citations[0]?.version !== dataset.data.activeVersion) throw Error("Data changed during analysis; retrying.");
      const row = result.rows[0];
      // Dates alone cannot prove ingestion completeness. Insufficient history
      // is omitted, and the UI labels this as observed records, not coverage.
      if (!row || !row.firstDate || String(row.firstDate).slice(0,10) > window.previousStart ||
          !row.lastDate || String(row.lastDate).slice(0,10) < window.weekStart ||
          row.current == null || row.previous == null) { base.skipped++; continue; }
      const current = Number(row.current), previous = Number(row.previous);
      const baseline = String(row.firstDate).slice(0,10) <= window.baselineStart && row.baseline != null ? Number(row.baseline) : null;
      if (![current, previous, ...(baseline === null ? [] : [baseline])].every(Number.isFinite)) { base.skipped++; continue; }
      base.measured++;
      const change = measureChange(current, previous, baseline);
      if (!change.notable) continue;
      const id = digest(JSON.stringify([spec.datasetId, spec.measure, spec.column, spec.timeColumn, spec.filter]));
      const old = (prior?.data.findings as ShowcaseFinding[] | undefined)?.find(f => f.id === id);
      ranked.push({
        id, title: spec.title.replace(/ over time$/i, ""), datasetId: dataset.id,
        dataset: noun(dataset), version: dataset.data.activeVersion, sql, format: spec.format,
        current, previous, baseline, delta: change.delta, changePercent: change.changePercent,
        baselinePercent: change.baselinePercent, direction: change.delta > 0 ? "up" : "down",
        changed: !old || old.current !== current || old.previous !== previous || old.baseline !== baseline,
        score: change.score,
      });
    }
    const latest = await metricsDatasets(store, scope);
    if (JSON.stringify(versions(latest)) !== JSON.stringify(versions(datasets))) throw Error("Data changed during analysis; retrying.");
    base.findings = ranked.sort((a,b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0,3).map(({score, ...f}) => f);
    base.status = !datasets.length ? "empty" : base.measured ? "ready" : "insufficient";
    base.computedAt = now.toISOString();
    await transaction(store, scope, async tx => {
      const old = await tx.get(SHOWCASE_ID);
      if (old) tx.update(old, base);
      else tx.put(resource(scope, "showcase", "Proactive Showcase", base, SHOWCASE_ID));
    });
    return base;
  } catch {
    const fallback: Showcase = prior?.data.computedAt
      ? { ...(prior.data as Showcase), stale: true, error: "Couldn’t refresh the showcase. Showing the last successful analysis." }
      : { ...base, status: "failed", stale: true, error: "Couldn’t analyse the current snapshots. Retrying automatically." };
    await transaction(store, scope, async tx => {
      const old = await tx.get(SHOWCASE_ID);
      const data = {...fallback, failedSignature: signature, retryAt: now.getTime() + 60000};
      if (old) tx.update(old, data);
      else tx.put(resource(scope, "showcase", "Proactive Showcase", data, SHOWCASE_ID));
    });
    return fallback;
  }
}
