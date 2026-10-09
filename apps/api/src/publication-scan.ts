import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Execution } from "../../../services/executor/src/engine.js";
import { config } from "./config.js";
import { execute } from "./executor.js";

// Materialize and validate one immutable query result, then stream its Parquet
// in bounded chunks. The executor still enforces filters and SQL isolation.
export async function* publicationScan(job: Execution, expectedRows?: number) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(job.scope))
    throw new Error("Invalid publication storage identity");
  const version = randomUUID();
  const snapshot = resolve(
    config.dataDir,
    "datasets",
    job.scope,
    version + ".parquet",
  );
  const scratchRoot = resolve(config.dataDir, "scratch");
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(resolve(scratchRoot, "publication-"));
  let db: DuckDBInstance | undefined;
  let connection: DuckDBConnection | undefined;
  try {
    const prepared = await execute({
      ...job,
      version,
      persist: true,
      limit: 1,
    });
    if (expectedRows !== undefined && prepared.profile.rows !== expectedRows)
      throw new Error(
        "Publication row count changed; workspace was not activated",
      );
    db = await DuckDBInstance.create(":memory:", {
      memory_limit: "128MB",
      threads: "1",
      temp_directory: scratch,
      max_temp_directory_size: "2GB",
      allow_unsigned_extensions: "false",
      autoinstall_known_extensions: "false",
      autoload_known_extensions: "false",
    });
    connection = await db.connect();
    const path = "'" + snapshot.replaceAll("'", "''") + "'";
    await connection.run(`SET allowed_paths = [${path}]`);
    await connection.run("SET enable_external_access = false");
    await connection.run("SET lock_configuration = true");
    const result = await connection.stream(
      `SELECT * FROM read_parquet(${path})`,
    );
    let count = 0;
    for await (const rows of result.yieldRowObjectJson()) {
      if (!rows.length) continue;
      // The first row must round-trip with the same JSON representation as the
      // checked executor result (including BIGINTs, dates, nulls and decimals).
      if (
        count === 0 &&
        JSON.stringify(rows[0]) !== JSON.stringify(prepared.rows[0])
      )
        throw new Error(
          "Publication first batch did not match its validated snapshot",
        );
      count += rows.length;
      yield rows;
    }
    if (count !== prepared.profile.rows)
      throw new Error(
        "Publication final count did not match its validated snapshot",
      );
  } finally {
    connection?.closeSync();
    db?.closeSync();
    // These are this scan's temporary outputs, never the imported snapshots.
    await rm(snapshot, { force: true });
    await rm(scratch, { recursive: true, force: true });
  }
}
