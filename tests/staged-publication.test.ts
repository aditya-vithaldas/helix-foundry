import { it, expect } from "vitest";
import { MemoryStore, resource, type Change } from "../apps/api/src/store.js";
import { stagingWriter } from "../apps/api/src/staged-publication.js";

it("reduces rejected staging plans without losing records or activating a partial generation", async () => {
  class LimitedPlanner extends MemoryStore {
    rejected = 0;
    async commit(scope: string, version: number, changes: Change[]) {
      if (changes.length > 2) {
        this.rejected++;
        throw new Error("planner error: unsupported cascades plan");
      }
      return super.commit(scope, version, changes);
    }
  }
  const store = new LimitedPlanner();
  const records = Array.from({ length: 9 }, (_, i) =>
    resource(
      "one",
      "object",
      String(i),
      { generation: "staged" },
      "object-" + i,
    ),
  );
  const write = stagingWriter(store, "one");
  await write(records.slice(0, 5));
  const rejected = store.rejected;
  await write(records.slice(5));
  expect(store.rejected).toBe(rejected);
  expect((await store.list("one", "object")).map((r) => r.id)).toEqual(
    records.map((r) => r.id),
  );
  expect(await store.get("one", "workspace")).toBeUndefined();
});

it("propagates other failures instead of claiming publication succeeded", async () => {
  class BrokenStore extends MemoryStore {
    async commit(): Promise<boolean> {
      throw new Error("storage unavailable");
    }
  }
  const store = new BrokenStore();
  await expect(
    stagingWriter(store, "one")([resource("one", "object", "one")]),
  ).rejects.toThrow("storage unavailable");
  expect(await store.list("one", "object")).toEqual([]);
});
