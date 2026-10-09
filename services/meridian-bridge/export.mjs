import { DuckDBInstance } from "@duckdb/node-api";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
const manifest = JSON.parse(await readFile("/bridge/manifest.json", "utf8"));
const db = await DuckDBInstance.create("/bridge/input.duckdb", {
  access_mode: "READ_ONLY",
  threads: "2",
  memory_limit: "512MB",
});
const connection = await db.connect();
await mkdir("/bridge/tables", { recursive: true });
try {
  const tables = [];
  for (const table of manifest.schema.tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(table.name))
      throw Error("Invalid table identifier");
    const key = `tables/${table.name}.parquet`,
      path = `/bridge/${key}`;
    const rows = Number(
      (
        await connection.runAndReadAll(
          `SELECT count(*) AS n FROM "${table.name}"`,
        )
      ).getRowObjectsJson()[0].n,
    );
    if (rows !== table.rows)
      throw Error(`Source count differs for ${table.name}`);
    await connection.run(
      `COPY "${table.name}" TO '${path}' (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
    const copied = Number(
      (
        await connection.runAndReadAll(
          `SELECT count(*) AS n FROM read_parquet('${path}')`,
        )
      ).getRowObjectsJson()[0].n,
    );
    if (copied !== rows) throw Error(`Export count differs for ${table.name}`);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    tables.push({
      key,
      rows,
      bytes: (await stat(path)).size,
      sha256: hash.digest("hex"),
    });
  }
  const rows = tables.reduce((n, t) => n + t.rows, 0);
  if (rows !== manifest.schema.totalRows) throw Error("Incomplete export");
  await writeFile(
    "/bridge/export.json",
    JSON.stringify({
      sha256: manifest.sha256,
      version: manifest.schema.version,
      through: manifest.schema.period.end,
      synthetic: true,
      exportedAt: new Date().toISOString(),
      tables,
      rows,
    }),
  );
} finally {
  connection.closeSync();
  db.closeSync();
}
