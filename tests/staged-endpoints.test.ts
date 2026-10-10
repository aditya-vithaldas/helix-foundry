import { expect, it, vi } from "vitest";
import { HelixStore, resource } from "../apps/api/src/store.js";

const request = (q: any) =>
  JSON.parse(
    JSON.stringify(q.toQueryRequest(), (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
const relation = (from: string, to: string) =>
  resource("scope", "relation", "Links", { from, to, generation: "g" });

it("resolves scoped object endpoints in bounded reads and preserves 64-bit IDs", async () => {
  const store = new HelixStore();
  const reads: any[] = [];
  let next = 0n;
  store.read = vi.fn(async (q) => {
    const read = request(q).query.read;
    reads.push(read);
    return Object.fromEntries(
      read.returns.map((name: string) => [
        name,
        [9223372036854775000n + next++],
      ]),
    );
  });
  const write = vi.fn(async (_q: any) => ({}));
  store.write = write;
  await store.stageRecords(
    "scope",
    Array.from({ length: 65 }, (_, i) => relation("from" + i, "shared")),
  );
  expect(reads.map((r) => r.entries.length)).toEqual([64, 2]);
  const first = reads[0].entries[0].query.root.id.input.limit;
  expect(first.count).toEqual({ literal: 2 });
  expect(first.input.where.predicate.eq.right.constant.string).toBe(
    "scope:object",
  );
  expect(JSON.stringify(first.input.where.input)).toContain("scope:from0");
  expect(write).toHaveBeenCalledTimes(1);
  const edge = request(write.mock.calls[0][0]).query.write.entries[1].query.root
    .add_e;
  expect(edge.input.nodes.reference.ids).toEqual(["9223372036854775000"]);
  expect(edge.to.ids).toEqual(["9223372036854775001"]);
});

it.each([{ ids: [] }, { ids: [1, 2] }, { ids: ["1"] }])(
  "rejects unresolved endpoints before any writes: %j",
  async ({ ids }) => {
    const store = new HelixStore();
    store.read = vi.fn(async () => ({ endpoint0: [1], endpoint1: ids }));
    store.write = vi.fn();
    await expect(
      store.stageRecords("scope", [relation("a", "b")]),
    ).rejects.toThrow("Missing or ambiguous staged relationship endpoint");
    expect(store.write).not.toHaveBeenCalled();
  },
);

it("does not resolve endpoints for object-only staging", async () => {
  const store = new HelixStore();
  store.read = vi.fn();
  store.write = vi.fn();
  await store.stageRecords("scope", [
    resource("scope", "object", "A", { generation: "g" }, "g_a"),
  ]);
  expect(store.read).not.toHaveBeenCalled();
  expect(store.write).toHaveBeenCalledTimes(1);
});
