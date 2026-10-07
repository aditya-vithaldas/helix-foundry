import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execute as localExecute } from "../services/executor/src/engine.js";
import { execute as remoteExecute } from "../apps/api/src/executor.js";
const execute = process.env.BENCH_HTTP === "1" ? remoteExecute : localExecute;
import { config } from "../apps/api/src/config.js";
const scope = "bench-" + randomUUID();
await mkdir(resolve(config.dataDir, "incoming", scope), { recursive: true });
const out = createWriteStream(
  resolve(config.dataDir, "incoming", scope, "million.jsonl"),
);
for (let i = 0; i < 1_000_000; i++)
  if (
    !out.write(
      JSON.stringify({
        id: i,
        region: ["NA", "EU", "APAC", "LATAM"][i % 4],
        amount: i % 1000,
        status: i % 5 ? "complete" : "pending",
      }) + "\n",
    )
  )
    await once(out, "drain");
out.end();
await once(out, "finish");
const start = performance.now();
const ingested = await execute({
  mode: "ingest",
  scope,
  version: "million",
  file: "million.jsonl",
});
const imported = performance.now();
const timings: number[] = [];
await Promise.all(
  Array.from({ length: 25 }, async (_, i) => {
    const s = performance.now();
    await execute({
      mode: "query",
      scope,
      version: "q" + i,
      inputs: [{ table: "orders", version: "million" }],
      sql: "SELECT region, sum(amount) revenue, count(*) orders FROM orders GROUP BY region",
    });
    timings.push(performance.now() - s);
  }),
);
const result = {
  rows: ingested.profile.rows,
  importMs: imported - start,
  queries: 25,
  mode:
    process.env.BENCH_HTTP === "1"
      ? "25 concurrent HTTP executor clients, 2 execution slots"
      : "25 concurrent in-process analytical queries",
  medianQueryMs: timings.sort((a, b) => a - b)[12],
  maxQueryMs: Math.max(...timings),
  inferenceIncluded: false,
  rssScope:
    "benchmark client process; excludes executor children and other services",
  rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  measuredAt: new Date().toISOString(),
};
await writeFile(
  resolve(config.dataDir, "benchmark.json"),
  JSON.stringify(result, null, 2),
);
console.log(result);
