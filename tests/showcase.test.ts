import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { execute as localExecute } from "../services/executor/src/engine.js";
// Real DuckDB queries, with hooks to count them, fail them or change data
// while one runs.
const executor = vi.hoisted(() => ({
  queries: 0,
  fail: (_sql: string): boolean => false,
  during: undefined as undefined | (() => Promise<unknown>),
}));
vi.mock("../apps/api/src/executor.js", () => ({
  execute: async (job: any) => {
    if (job.mode === "query") {
      executor.queries++;
      if (executor.fail(job.sql)) throw new Error("executor unavailable");
      const during = executor.during;
      executor.during = undefined;
      await during?.();
    }
    return localExecute(job);
  },
}));
import { createApp } from "../apps/api/src/app.js";
import { MemoryStore } from "../apps/api/src/store.js";
import { ingestRows } from "../apps/api/src/datasets.js";
import { config } from "../apps/api/src/config.js";
import { weeklySql } from "../apps/api/src/showcase.js";
import {
  coversWeek,
  measureChange,
  relativeChange,
  showcaseWindow,
} from "../apps/api/src/showcase-calculations.js";
import type { MetricSpec, Resource } from "../packages/shared/src/index.js";
import type { Showcase } from "../packages/shared/src/showcase.js";

const NOW = new Date("2026-10-09T09:00:00Z");

describe("showcase calculations", () => {
  it("uses Monday-start complete weeks across the Sunday boundary and year end", () => {
    const friday = showcaseWindow(NOW);
    expect(friday).toEqual({
      weekStart: "2026-09-28",
      weekEnd: "2026-10-05",
      previousStart: "2026-09-21",
      baselineStart: "2026-08-31",
    });
    expect(showcaseWindow(new Date("2026-10-11T23:59:59Z")).weekEnd).toBe(
      "2026-10-05",
    );
    expect(showcaseWindow(new Date("2026-10-12T00:00:00Z")).weekEnd).toBe(
      "2026-10-12",
    );
    expect(showcaseWindow(new Date("2027-01-01T00:00:00Z")).weekStart).toBe(
      "2026-12-21",
    );
  });
  it("applies the threshold without inventing percentages from zero", () => {
    expect(measureChange(109, 100, 100).notable).toBe(false);
    expect(measureChange(110, 100, 100).notable).toBe(true);
    expect(measureChange(0, 0, null).notable).toBe(false);
    expect(measureChange(5, 0, null)).toMatchObject({
      changePercent: null,
      notable: true,
    });
    expect(measureChange(80, 100, 100).baselinePercent).toBe(-20);
    expect(relativeChange(-80, -100)).toBe(20);
  });
  it("only treats a week as covered when records reach its last day", () => {
    const w = showcaseWindow(NOW);
    expect(coversWeek("2026-09-29 13:00:00", w)).toBe(false);
    expect(coversWeek("2026-10-03 23:59:59", w)).toBe(false);
    expect(coversWeek("2026-10-04 00:00:00", w)).toBe(true);
    expect(coversWeek("2026-10-08 10:00:00", w)).toBe(true);
  });
  it("compiles exclusive boundaries and four separate baseline weeks", () => {
    const dataset = {
      id: "orders",
      data: {
        activeVersion: "v1",
        profile: {
          columns: [
            { name: "created_at", type: "TIMESTAMP" },
            { name: "revenue", type: "DOUBLE" },
          ],
        },
      },
    } as unknown as Resource;
    const spec: MetricSpec = {
      title: "Revenue",
      why: "",
      kind: "kpi",
      datasetId: "orders",
      measure: "avg",
      column: "revenue",
      timeColumn: "created_at",
      format: "currency",
      scale: "cents",
    };
    const sql = weeklySql(spec, dataset, showcaseWindow(NOW))!;
    expect(sql).toMatch(/"__ts" < TIMESTAMP '2026-10-05'/);
    expect(sql.match(/AS DOUBLE/g)).toHaveLength(6);
    expect(sql).toMatch(/\/ 4\.0 AS baseline/);
    expect(
      weeklySql({ ...spec, column: "invented" }, dataset, showcaseWindow(NOW)),
    ).toBeUndefined();
  });
});

describe("showcase reports", () => {
  let store: MemoryStore,
    app: Awaited<ReturnType<typeof createApp>>,
    scope: string;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    Object.assign(executor, {
      queries: 0,
      fail: () => false,
      during: undefined,
    });
    store = new MemoryStore();
    app = await createApp(store);
    await app.ready();
    scope = (await app.inject({ method: "GET", url: "/api/v1/me" })).json()
      .workspaces[0].id;
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await app.close();
    for (const d of ["incoming", "datasets"])
      await rm(resolve(config.dataDir, d, scope), {
        recursive: true,
        force: true,
      });
  });
  const showcase = async (): Promise<Showcase> => {
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/workspaces/${scope}/showcase`,
    });
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };
  const later = (ms: number) => vi.setSystemTime(new Date(NOW.getTime() + ms));
  // One order an hour from `from` until `until`; two an hour from `doubled`.
  function orders(from: string, until: string, doubled?: string) {
    const rows: Record<string, unknown>[] = [];
    for (let t = Date.parse(from); t < Date.parse(until); t += 3600000)
      for (let i = 0; i < (doubled && t >= Date.parse(doubled) ? 2 : 1); i++)
        rows.push({
          order_id: `o${rows.length}`,
          created_at: new Date(t).toISOString(),
          revenue: 10,
        });
    return rows;
  }
  const load = (rows: Record<string, unknown>[], datasetId?: string) =>
    ingestRows(store, scope, "Orders", rows, undefined, datasetId);
  const doubledLastWeek = () =>
    orders("2026-08-01", "2026-10-09", "2026-09-28");
  const sums = (r: Showcase) =>
    r.findings.find((f) => f.current === 3360 && f.previous === 1680);

  it("reports measured weekly changes and reruns only when snapshots change", async () => {
    const ds = await load(doubledLastWeek());
    const first = await showcase();
    expect(first).toMatchObject({ status: "ready", measured: 2, failed: 0 });
    expect(first.findings).toHaveLength(2);
    expect(sums(first)).toMatchObject({
      baseline: 1680,
      changePercent: 100,
      changed: true,
      version: ds.data.activeVersion,
    });
    const queries = executor.queries;
    await showcase();
    expect(executor.queries).toBe(queries);
    const next = await load(doubledLastWeek(), ds.id);
    const second = await showcase();
    expect(executor.queries).toBeGreaterThan(queries);
    expect(sums(second)).toMatchObject({
      changed: false,
      version: next.data.activeVersion,
    });
  });

  it("leaves out a source that stopped syncing during last week", async () => {
    const ds = await load(orders("2026-08-01", "2026-09-30"));
    const r = await showcase();
    expect(r.findings).toEqual([]);
    expect(r.status).toBe("insufficient");
    expect(r.stalled).toEqual([
      { datasetId: ds.id, dataset: "Orders", lastDate: "2026-09-29" },
    ]);
  });

  it("omits short history and highlights nothing when nothing moved", async () => {
    await load(orders("2026-09-25", "2026-10-09"));
    expect(await showcase()).toMatchObject({
      status: "insufficient",
      findings: [],
    });
    expect((await showcase()).stalled).toBeUndefined();
  });

  it("reports nothing notable for steady data", async () => {
    await load(orders("2026-08-01", "2026-10-09"));
    expect(await showcase()).toMatchObject({
      status: "ready",
      measured: 2,
      findings: [],
    });
  });

  it("keeps the other metrics when one fails, then retries it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await load(doubledLastWeek());
    executor.fail = (sql) => /count\(\*\) FILTER/.test(sql);
    const partial = await showcase();
    expect(partial).toMatchObject({ status: "ready", measured: 1, failed: 1 });
    expect(partial.error).toBeUndefined();
    expect(sums(partial)).toBeDefined();
    expect(logged).toHaveBeenCalled();
    executor.fail = () => false;
    const queries = executor.queries;
    later(60000);
    await showcase();
    expect(executor.queries).toBe(queries);
    later(301000);
    const retried = await showcase();
    expect(retried).toMatchObject({ measured: 2, failed: 0 });
    expect(retried.findings).toHaveLength(2);
  });

  it("keeps the last successful report when nothing can be queried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ds = await load(doubledLastWeek());
    await showcase();
    const next = await load(doubledLastWeek(), ds.id);
    executor.fail = () => true;
    const failed = await showcase();
    expect(failed.stale).toBe(true);
    expect(failed.error).toBeTruthy();
    expect(sums(failed)?.version).toBe(ds.data.activeVersion);
    const queries = executor.queries;
    await showcase();
    expect(executor.queries).toBe(queries);
    executor.fail = () => false;
    later(61000);
    const recovered = await showcase();
    expect(recovered.error).toBeUndefined();
    expect(sums(recovered)?.version).toBe(next.data.activeVersion);
  });

  it("keeps the previous report when a snapshot changes mid-analysis", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ds = await load(doubledLastWeek());
    await showcase();
    await load(doubledLastWeek(), ds.id);
    let raced: Resource | undefined;
    executor.during = async () => {
      raced = await load(doubledLastWeek(), ds.id);
    };
    const report = await showcase();
    expect(report.stale).toBe(true);
    expect(sums(report)?.version).toBe(ds.data.activeVersion);
    const settled = await showcase();
    expect(settled.error).toBeUndefined();
    expect(sums(settled)?.version).toBe(raced!.data.activeVersion);
  });
});
