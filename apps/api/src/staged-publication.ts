import type { Resource } from "../../../packages/shared/src/index.js";
import { transaction, type Store } from "./store.js";

// Only inactive generation records are written here. Activation remains one
// atomic transaction after every record and relationship has been staged.
export function stagingWriter(store: Store, scope: string) {
  let batchSize = 500;
  return async (records: Resource[]) => {
    let offset = 0;
    while (offset < records.length) {
      const batch = records.slice(offset, offset + batchSize);
      try {
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
