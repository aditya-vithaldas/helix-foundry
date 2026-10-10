import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resource } from "../apps/api/src/store.js";
import { BuildProgress } from "../apps/web/src/build-progress.js";
import { buildWork, retainMeasurement } from "../apps/web/src/build-work.js";

const measurement = {
  generation: "new",
  records: 1000,
  relationships: 250,
  totalRecords: 1000,
  estimatedRelationships: 1000,
  sampledAt: 60000,
  startedAt: new Date(0).toISOString(),
};
describe("workspace build feedback", () => {
  it("reserves relationship work and final checks after all records are created", () => {
    expect(buildWork(measurement, false)).toEqual({
      percent: 42,
      remaining: "Remaining: relationships and final checks",
    });
    expect(buildWork({ ...measurement, relationships: 1000 }, false)).toEqual({
      percent: 95,
      remaining: "Remaining: final checks",
    });
    expect(buildWork(measurement, true).percent).toBe(100);
    expect(
      buildWork(
        { ...measurement, records: 500, estimatedRelationships: 0 },
        false,
      ).percent,
    ).toBe(47);
  });
  it("retains counts through missing, stale and regressing polls, and resets for a new generation", () => {
    expect(retainMeasurement(measurement, undefined, "new")).toEqual(
      measurement,
    );
    expect(
      retainMeasurement(
        measurement,
        { ...measurement, records: 0, sampledAt: 1000 },
        "new",
      ),
    ).toEqual(measurement);
    const next = retainMeasurement(
      measurement,
      {
        ...measurement,
        records: 900,
        relationships: 200,
        sampledAt: 70000,
        estimatedRelationships: 2000,
      },
      "new",
    );
    expect(buildWork(next, false).percent).toBe(42);
    expect(retainMeasurement(measurement, undefined, "other")).toBeUndefined();
  });
  for (const status of ["running", "failed", "succeeded"])
    it(`renders distinct counts and ${status} state`, () => {
      const run = resource("one", "run", "build", {
        status,
        stage: "publishing",
        publicationGeneration: "new",
        publicationProgress: measurement,
      });
      const html = renderToStaticMarkup(
        createElement(BuildProgress, { run, disconnected: false }),
      );
      expect(html).toContain("Records:");
      expect(html).toContain("Relationships:");
      expect(html).toContain(
        `aria-valuenow="${status === "succeeded" ? 100 : 42}"`,
      );
      if (status === "failed") expect(html).toContain("Build failed");
      if (status === "succeeded") expect(html).toContain("Workspace ready");
    });
});
