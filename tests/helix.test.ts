import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { HelixStore, transaction, resource } from "../apps/api/src/store.js";
import { stagingWriter } from "../apps/api/src/staged-publication.js";
it.skipIf(process.env.TEST_HELIX !== "1")(
  "persists atomic scoped changes and graph relationships in real HelixDB",
  async () => {
    const store = new HelixStore();
    await store.init();
    const scope = "test-" + randomUUID();
    await transaction(store, scope, async (tx) => {
      tx.put(resource(scope, "object", "Alice", {}, "a"));
      tx.put(resource(scope, "object", "Bob", {}, "b"));
    });
    await transaction(store, scope, async (tx) => {
      tx.put(
        resource(
          scope,
          "relation",
          "Knows",
          { from: "a", to: "b", generation: "g" },
          "rel",
        ),
      );
    });
    expect(await store.neighbors(scope, "a")).toEqual(["b"]);
    expect(await store.get("other", "a")).toBeUndefined();
    const v = await store.version(scope);
    expect(
      await store.commit(scope, v - 1, [
        { put: resource(scope, "test", "stale", {}, "stale") },
      ]),
    ).toBe(false);
    expect(await store.get(scope, "stale")).toBeUndefined();
    await transaction(store, scope, async (tx) => tx.delete("rel"));
    expect(await store.neighbors(scope, "a")).toEqual([]);
    const reopened = new HelixStore();
    expect((await reopened.get(scope, "a"))?.name).toBe("Alice");
    await transaction(store, scope, async (tx) => {
      for (const r of await tx.list()) tx.delete(r.id);
    });
  },
);

it.skipIf(process.env.TEST_HELIX !== "1")(
  "stages fresh records and graph edges without changing the active generation or workspace revision",
  async () => {
    const store = new HelixStore();
    await store.init();
    const scope = "test-stage-" + randomUUID();
    const generation = randomUUID();
    try {
      await transaction(store, scope, async (tx) =>
        tx.put(
          resource(
            scope,
            "workspace",
            "Test",
            { activeGeneration: "previous" },
            "workspace",
          ),
        ),
      );
      const version = await store.version(scope);
      const stage = stagingWriter(store, scope, generation);
      await stage(
        Array.from({ length: 1001 }, (_, i) =>
          resource(
            scope,
            "object",
            String(i),
            { generation },
            generation + "_" + i,
          ),
        ),
      );
      const relationStart = Date.now();
      await stage(
        Array.from({ length: 500 }, (_, i) =>
          resource(scope, "relation", "links", {
            generation,
            from: generation + "_" + i,
            to: generation + "_" + (1000 - i),
          }),
        ),
      );
      console.info(
        "500 staged relationships:",
        Date.now() - relationStart,
        "ms",
      );
      expect(await store.version(scope)).toBe(version);
      expect((await store.get(scope, "workspace"))?.data.activeGeneration).toBe(
        "previous",
      );
      expect(await store.publicationCounts(scope, generation)).toEqual({
        generation,
        records: 1001,
        relationships: 500,
      });
      expect(await store.neighbors(scope, generation + "_0")).toEqual([
        generation + "_1000",
      ]);
      expect(
        (await new HelixStore().get(scope, generation + "_1000"))?.name,
      ).toBe("1000");
      // A realistic definition batch must still activate atomically through
      // the guarded path after large append staging has completed.
      await transaction(store, scope, async (tx) => {
        const workspace = (await tx.get("workspace"))!;
        tx.update(workspace, {
          ...workspace.data,
          activeGeneration: generation,
        });
        for (let i = 0; i < 32; i++)
          tx.put(resource(scope, "objectType", "Type " + i, { generation }));
      });
      expect((await store.get(scope, "workspace"))?.data.activeGeneration).toBe(
        generation,
      );
      expect(await store.list(scope, "objectType")).toHaveLength(32);
    } finally {
      const rows = await store.list(scope);
      for (let offset = 0; offset < rows.length; offset += 20)
        await transaction(store, scope, async (tx) => {
          for (const row of rows.slice(offset, offset + 20)) tx.delete(row.id);
        });
    }
  },
);
