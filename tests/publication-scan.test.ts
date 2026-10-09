import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { execute as localExecute } from "../services/executor/src/engine.js";
vi.mock("../apps/api/src/executor.js", () => ({
  execute: vi.fn((job: any) => localExecute(job)),
}));
import { execute } from "../apps/api/src/executor.js";
import { publicationScan } from "../apps/api/src/publication-scan.js";
import { config } from "../apps/api/src/config.js";
const scope = "scan-" + randomUUID();
const directory = resolve(config.dataDir, "datasets", scope);
const job = {
  mode: "query" as const,
  scope,
  inputs: [{ table: "source", version: "source" }],
  sql: "SELECT * FROM source WHERE keep ORDER BY id",
};
beforeAll(async () => {
  await mkdir(directory, { recursive: true });
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  try {
    await c.run(
      `COPY (SELECT i id, (9007199254740993 + i)::BIGINT huge, (i / 10)::DECIMAL(18,2) amount, DATE '2026-10-09' AS record_date, CASE WHEN i % 2 = 0 THEN NULL ELSE 'line' || chr(10) || '日本語' END AS payload, i % 3 <> 0 keep FROM range(9001) t(i)) TO '${directory.replaceAll("'", "''")}/source.parquet' (FORMAT PARQUET)`,
    );
  } finally {
    c.closeSync();
    db.closeSync();
  }
});
afterAll(() => rm(directory, { recursive: true, force: true }));
it("executes once and streams all filtered rows with matching first and last batches and lossless JSON values", async () => {
  const expected = await localExecute({
    ...job,
    version: randomUUID(),
    limit: 1000,
  });
  const expectedLast = await localExecute({
    ...job,
    version: randomUUID(),
    sql: job.sql + " LIMIT 1 OFFSET 5999",
    limit: 1,
  });
  vi.mocked(execute).mockClear();
  const batches = [];
  for await (const rows of publicationScan(job, 6000)) batches.push(rows);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(batches.length).toBeGreaterThan(1);
  expect(Math.max(...batches.map((b) => b.length))).toBeLessThanOrEqual(2048);
  const rows = batches.flat();
  expect(rows.length).toBe(6000);
  expect(new Set(rows.map((r) => r.id)).size).toBe(6000);
  expect(rows.slice(0, 1000)).toEqual(expected.rows);
  expect(rows.at(-1)).toEqual(expectedLast.rows[0]);
  expect(rows[0].huge).toBe("9007199254740994");
  expect(await readdir(directory)).toEqual(["source.parquet"]);
});
it("rejects a count mismatch before staging and cleans only its temporary output", async () => {
  const rows: unknown[] = [];
  await expect(
    (async () => {
      for await (const batch of publicationScan(job, 5999)) rows.push(...batch);
    })(),
  ).rejects.toThrow("row count changed");
  expect(rows).toEqual([]);
  expect(await readdir(directory)).toEqual(["source.parquet"]);
});
it("closes an interrupted stream without removing the imported source", async () => {
  for await (const rows of publicationScan(job)) {
    expect(rows.length).toBeGreaterThan(0);
    break;
  }
  expect(await readdir(directory)).toEqual(["source.parquet"]);
});
