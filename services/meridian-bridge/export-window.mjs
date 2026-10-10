import { DuckDBInstance } from "@duckdb/node-api";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { validateManifest } from "./server.mjs";

// Create a standalone cohort; the immutable full snapshot is never modified.
const [snapshotDirectory, destination] = process.argv.slice(2);
if (!snapshotDirectory || !destination)
  throw Error(
    "Usage: node export-window.mjs SNAPSHOT_DIRECTORY NEW_OUTPUT_DIRECTORY",
  );
const source = resolve(snapshotDirectory),
  output = resolve(destination);
if (output === source || output.startsWith(source + "/"))
  throw Error("Keep the subset outside the original snapshot");
const manifest = validateManifest(
  JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8")),
);
if (
  !manifest.schema?.synthetic ||
  !/^\d{4}-\d{2}-\d{2}$/.test(manifest.schema.period.end)
)
  throw Error("Expected a verified synthetic Meridian manifest");
const hash = createHash("sha256");
for await (const chunk of createReadStream(resolve(source, "input.duckdb")))
  hash.update(chunk);
if (hash.digest("hex") !== manifest.sha256)
  throw Error("Original snapshot checksum mismatch");
await mkdir(output, { recursive: false, mode: 0o700 });
await mkdir(resolve(output, "tables"));
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const db = await DuckDBInstance.create(":memory:", {
  memory_limit: "512MB",
  threads: "1",
});
const c = await db.connect();
const scalar = async (sql) =>
  (await c.runAndReadAll(sql)).getRowObjectsJson()[0];
try {
  await c.run(
    `ATTACH ${quote(resolve(source, "input.duckdb"))} AS original (READ_ONLY)`,
  );
  const end = manifest.schema.period.end;
  const period = await scalar(
    `SELECT CAST(DATE '${end}' + INTERVAL 1 DAY - INTERVAL 1 MONTH AS VARCHAR) AS start, '${end}' AS "end"`,
  );
  const start = period.start.slice(0, 10);
  const between = (column) =>
    `${column} BETWEEN DATE '${start}' AND DATE '${end}'`;
  const views = {
    orders: `SELECT * FROM original.orders WHERE ${between("order_date")}`,
    order_items:
      "SELECT * FROM original.order_items WHERE order_id IN (SELECT order_id FROM orders)",
    sessions: `SELECT * FROM original.sessions WHERE ${between("session_date")}`,
    customers:
      "SELECT * FROM original.customers WHERE customer_id IN (SELECT customer_id FROM orders UNION SELECT customer_id FROM sessions)",
    products:
      "SELECT * FROM original.products WHERE product_id IN (SELECT product_id FROM order_items)",
    regions:
      "SELECT * FROM original.regions WHERE region_id IN (SELECT region_id FROM customers)",
    categories:
      "SELECT * FROM original.categories WHERE category_id IN (SELECT category_id FROM products)",
    payments:
      "SELECT * FROM original.payments WHERE order_id IN (SELECT order_id FROM orders)",
    shipments:
      "SELECT * FROM original.shipments WHERE order_id IN (SELECT order_id FROM orders)",
    calendar: `SELECT * FROM original.calendar WHERE ${between('"date"')}`,
    business_events: `SELECT * FROM original.business_events WHERE start_date <= DATE '${end}' AND end_date >= DATE '${start}'`,
    market_snapshots: `SELECT * FROM original.market_snapshots WHERE ${between("snapshot_date")}`,
    generation_runs: `SELECT * FROM original.generation_runs WHERE ${between('"date"')}`,
  };
  for (const [name, sql] of Object.entries(views))
    await c.run(`CREATE VIEW "${name}" AS ${sql}`);
  const foreignKeys = [
    ["orders", "customer_id", "customers", "customer_id"],
    ["customers", "region_id", "regions", "region_id"],
    ["order_items", "order_id", "orders", "order_id"],
    ["order_items", "product_id", "products", "product_id"],
    ["products", "category_id", "categories", "category_id"],
    ["payments", "order_id", "orders", "order_id"],
    ["shipments", "order_id", "orders", "order_id"],
    ["sessions", "customer_id", "customers", "customer_id"],
    ["sessions", "order_id", "orders", "order_id"],
  ];
  for (const [child, fk, parent, pk] of foreignKeys) {
    const { n } = await scalar(
      `SELECT count(*) AS n FROM "${child}" c WHERE c."${fk}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${parent}" p WHERE p."${pk}"=c."${fk}")`,
    );
    if (Number(n)) throw Error(`Subset has orphaned ${child}.${fk} references`);
  }
  const tables = [];
  for (const name of Object.keys(views)) {
    const path = resolve(output, "tables", name + ".parquet");
    const rows = Number(
      (await scalar(`SELECT count(*) AS n FROM "${name}"`)).n,
    );
    await c.run(
      `COPY "${name}" TO ${quote(path)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
    const copied = Number(
      (await scalar(`SELECT count(*) AS n FROM read_parquet(${quote(path)})`))
        .n,
    );
    if (copied !== rows) throw Error("Export count mismatch: " + name);
    tables.push({ name, rows, bytes: (await stat(path)).size });
  }
  const firstOrder = Number(
    (await scalar("SELECT min(order_id) AS id FROM orders")).id,
  );
  const summary = {
    synthetic: true,
    originalSnapshot: manifest.sha256,
    period: { start, end },
    firstOrder,
    foreignKeysVerified: foreignKeys.length,
    tables,
    rows: tables.reduce((n, t) => n + t.rows, 0),
    originalRows: manifest.schema.totalRows,
  };
  await writeFile(
    resolve(output, "export.json"),
    JSON.stringify(summary, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(summary));
} finally {
  c.closeSync();
  db.closeSync();
}
