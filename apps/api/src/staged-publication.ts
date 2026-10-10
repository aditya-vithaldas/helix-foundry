import type { Resource } from "../../../packages/shared/src/index.js";
import { transaction, type Store } from "./store.js";

// Only inactive generation records are written here. Activation remains one
// atomic transaction after every record and relationship has been staged.
export function stagingWriter(
  store: Store,
  scope: string,
  generation?: string,
) {
  let batchSize = 500;
  let checked = false;
  return async (records: Resource[]) => {
    if (generation && store.stageRecords) {
      if (!checked) {
        if (
          (await store.get(scope, "workspace"))?.data.activeGeneration ===
          generation
        )
          throw new Error("Cannot stage records in the active generation");
        checked = true;
      }
      for (const record of records)
        if (
          record.workspaceId !== scope ||
          record.data.generation !== generation ||
          !["object", "relation"].includes(record.kind) ||
          (record.kind === "object" &&
            !record.id.startsWith(generation + "_")) ||
          (record.kind === "relation" &&
            (!record.data.from?.startsWith(generation + "_") ||
              !record.data.to?.startsWith(generation + "_")))
        )
          throw new Error("Invalid inactive generation record");
    }
    let offset = 0;
    while (offset < records.length) {
      const batch = records.slice(offset, offset + batchSize);
      try {
        if (generation && store.stageRecords)
          await store.stageRecords(scope, batch);
        else
          await transaction(store, scope, async (tx) => {
            for (const record of batch) tx.put(record);
          });
        offset += batch.length;
      } catch (error) {
        // This is a pre-execution planner rejection, so no part of this batch
        // was committed. Use smaller plans for this and subsequent batches.
        if (
          !String(error).includes("unsupported cascades plan") ||
          batchSize === 1
        )
          throw error;
        batchSize = Math.max(1, Math.floor(batchSize / 2));
      }
    }
  };
}
