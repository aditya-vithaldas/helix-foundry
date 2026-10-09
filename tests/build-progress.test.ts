import { describe, it, expect, vi } from "vitest";
import { MemoryStore, resource, transaction } from "../apps/api/src/store.js";
import { publicationProgress } from "../apps/api/src/publication-progress.js";
import {
  remainingSeconds,
  remainingLabel,
  type PublicationMeasurement,
} from "../apps/web/src/build-estimate.js";

describe("publication measurements", () => {
  it("counts only the current workspace and generation, and refuses legacy counts from a previous build", async () => {
    const store = new MemoryStore();
    for (const scope of ["one", "two"])
      await transaction(store, scope, async (tx) => {
        for (const generation of ["old", "new"])
          for (const kind of ["object", "relation"])
            tx.put(resource(scope, kind, kind, { generation }));
      });
    expect(await store.publicationCounts("one", "new")).toEqual({
      generation: "new",
      records: 1,
      relationships: 1,
    });
    expect(
      await store.publicationCounts("one", undefined, "2999-01-01T00:00:00Z"),
    ).toBeUndefined();
  });
  it("coalesces polls and reports actual counts without marking an incomplete workspace ready", async () => {
    const counts = vi.fn(async () => ({
      generation: "new",
      records: 20,
      relationships: 0,
    }));
    const store = { publicationCounts: counts };
    const run = resource("one", "run", "build", {
      status: "running",
      stage: "publishing",
      publicationGeneration: "new",
      events: [{ stage: "publishing", at: new Date().toISOString() }],
    });
    const proposal = resource("one", "proposal", "build", {
      bundle: {
        ontology: [{ name: "Order", datasetId: "orders" }],
        relationships: [{ fromType: "Order" }],
      },
    });
    const dataset = resource(
      "one",
      "dataset",
      "Orders",
      { profile: { rows: 100 } },
      "orders",
    );
    const [first, second] = await Promise.all([
      publicationProgress(store, "one", run, proposal, [dataset]),
      publicationProgress(store, "one", run, proposal, [dataset]),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      records: 20,
      totalRecords: 100,
      estimatedRelationships: 100,
    });
    expect(counts).toHaveBeenCalledTimes(1);
    expect(run.data.status).toBe("running");
    expect(
      await publicationProgress(
        store,
        "one",
        { ...run, data: { ...run.data, status: "succeeded" } },
        proposal,
        [dataset],
      ),
    ).toBeUndefined();
  });
});

describe("remaining time from processing velocity", () => {
  const sample = (
    sampledAt: number,
    records: number,
  ): PublicationMeasurement => ({
    generation: "new",
    records,
    relationships: 0,
    totalRecords: 1000,
    estimatedRelationships: 500,
    sampledAt,
    startedAt: new Date(0).toISOString(),
  });
  it("adapts to recent velocity and includes relationship work", () => {
    const current = sample(60000, 600);
    expect(remainingSeconds(current, [], 60000)).toBe(90);
    expect(remainingSeconds(current, [sample(30000, 100)], 60000)).toBeCloseTo(
      54,
    );
    expect(remainingSeconds(current, [sample(30000, 550)], 60000)).toBe(540);
    expect(remainingLabel(90)).toBe("~2–3 min remaining");
  });
  it("withholds estimates while stopped, stale, starting, or using another generation", () => {
    const current = sample(60000, 600);
    expect(
      remainingSeconds(current, [sample(30000, 600)], 60000),
    ).toBeUndefined();
    expect(remainingSeconds(current, [], 90000)).toBeUndefined();
    expect(remainingSeconds(sample(1000, 10), [], 1000)).toBeUndefined();
    expect(
      remainingSeconds(
        current,
        [{ ...sample(30000, 100), generation: "old" }],
        60000,
      ),
    ).toBe(90);
  });
});
