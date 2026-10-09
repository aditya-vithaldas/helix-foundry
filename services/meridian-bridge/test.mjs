import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createBridge, validateManifest } from "./server.mjs";
const sha256 = "a".repeat(64);
const manifest = () => ({
  sha256,
  object: "snapshots/2026-10-08-a.duckdb",
  objectGeneration: "123",
  schema: {
    synthetic: true,
    totalRows: 3,
    tables: [{ name: "orders", rows: 3 }],
  },
});
test("rejects non-synthetic, duplicate, incomplete and unsafe manifests", () => {
  assert.equal(validateManifest(manifest()).sha256, sha256);
  for (const change of [
    (m) => (m.schema.synthetic = false),
    (m) => (m.schema.tables[0].name = "../orders"),
    (m) => (m.schema.totalRows = 4),
    (m) => (m.objectGeneration = "1?alt=media"),
    (m) => m.schema.tables.push({ name: "orders", rows: 0 }),
  ]) {
    const m = manifest();
    change(m);
    assert.throws(() => validateManifest(m));
  }
});
test("serves full objects, rejects writes and traversal, and retains a good snapshot after refresh failure", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "meridian-bridge-test-"));
  const data = Buffer.from("complete-parquet-fixture");
  await mkdir(join(directory, "snapshots", sha256, "tables"), {
    recursive: true,
  });
  await writeFile(
    join(directory, "snapshots", sha256, "tables/orders.parquet"),
    data,
  );
  const initial = {
    sha256,
    version: "daily-2026-10-08",
    through: "2026-10-08",
    rows: 3,
    exportedAt: "2026-10-09T10:00:00Z",
    tables: [
      { key: "tables/orders.parquet", rows: 3, bytes: data.length, sha256 },
    ],
  };
  let calls = 0;
  const bridge = createBridge({
    directory,
    initial,
    refresh: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      throw Error("Source unavailable");
    },
  });
  bridge.server.listen(0, "127.0.0.1");
  await once(bridge.server, "listening");
  t.after(async () => {
    await new Promise((r) => bridge.server.close(r));
    await rm(directory, { recursive: true });
  });
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  const listing = await (
    await fetch(base + "/meridian?list-type=2&prefix=tables/")
  ).text();
  assert.match(listing, /<Key>tables\/orders.parquet<\/Key>/);
  assert.match(listing, /<IsTruncated>false<\/IsTruncated>/);
  assert.equal(
    (await fetch(base + "/meridian?list-type=2&prefix=missing/")).status,
    200,
  );
  const object = await fetch(base + "/meridian/tables/orders.parquet");
  assert.deepEqual(Buffer.from(await object.arrayBuffer()), data);
  assert.equal(
    object.headers.get("x-amz-meta-dataset-version"),
    initial.version,
  );
  assert.equal(
    (
      await fetch(base + "/meridian/tables/orders.parquet", { method: "HEAD" })
    ).headers.get("content-length"),
    String(data.length),
  );
  assert.equal((await fetch(base + "/meridian/../current.json")).status, 404);
  assert.equal(
    (await fetch(base + "/meridian/tables/%2e%2e%2fcurrent.json")).status,
    404,
  );
  assert.equal(
    (
      await fetch(base + "/meridian/tables/orders.parquet", {
        method: "PUT",
        body: "overwrite",
      })
    ).status,
    405,
  );
  await Promise.all([bridge.update(), bridge.update()]);
  assert.equal(calls, 1);
  assert.equal(bridge.state(), initial);
  assert.equal((await fetch(base + "/health")).status, 200);
  assert.equal(
    (await (await fetch(base + "/health")).json()).refreshError,
    "Source unavailable",
  );
});
test("does not report ready or serve an empty replacement before the first successful refresh", async (t) => {
  const bridge = createBridge({
    directory: tmpdir(),
    refresh: async () => {
      throw Error("Missing cloud access");
    },
  });
  bridge.server.listen(0, "127.0.0.1");
  await once(bridge.server, "listening");
  t.after(() => new Promise((r) => bridge.server.close(r)));
  await bridge.update();
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  assert.equal((await fetch(base + "/health")).status, 503);
  assert.equal((await fetch(base + "/meridian?list-type=2")).status, 503);
});
