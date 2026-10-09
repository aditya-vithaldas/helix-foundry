import type { Resource } from "../../../packages/shared/src/index.js";
import type { Store } from "./store.js";

type ProgressStore = Pick<Store, "publicationCounts">;
const cache = new WeakMap<
  object,
  Map<string, { at: number; value: any; pending?: Promise<any> }>
>();

export async function publicationProgress(
  store: ProgressStore,
  scope: string,
  run: Resource,
  proposal: Resource,
  datasets: Resource[],
) {
  if (
    !store.publicationCounts ||
    run.data.stage !== "publishing" ||
    run.data.status !== "running"
  )
    return;
  const startedAt = run.data.events?.findLast(
    (e: any) => e.stage === "publishing",
  )?.at;
  if (!startedAt) return;
  // Counts are read at most once every five seconds; concurrent polls share work.
  let entries = cache.get(store);
  if (!entries) cache.set(store, (entries = new Map()));
  const key = scope + ":" + run.id + ":" + startedAt;
  const saved = entries.get(key);
  if (saved?.pending) return saved.pending;
  if (saved && Date.now() - saved.at < 5000) return saved.value;
  if (entries.size >= 64) entries.delete(entries.keys().next().value!);
  const entry: { at: number; value: any; pending?: Promise<any> } = {
    at: Date.now(),
    value: saved?.value,
  };
  entries.set(key, entry);
  entry.pending = (async () => {
    try {
      const counts = await store.publicationCounts!(
        scope,
        run.data.publicationGeneration,
        run.data.attempts === 1 ? startedAt : undefined,
      );
      if (!counts) return undefined;
      const rows = new Map(
        datasets.map((d) => [d.id, d.data.profile?.rows || 0]),
      );
      for (const [id, preview] of Object.entries(
        proposal.data.validation?.previews || {},
      ))
        if (!rows.has(id)) rows.set(id, (preview as any).profile?.rows || 0);
      const ontology: { name: string; datasetId: string }[] =
        proposal.data.bundle?.ontology || [];
      const types = new Map(
        ontology.map((t) => [t.name, rows.get(t.datasetId) || 0]),
      );
      const totalRecords = ontology.reduce(
        (total, type) => total + (types.get(type.name) || 0),
        0,
      );
      // Foreign-key links commonly produce one relationship per source record.
      // This is a work estimate, never a claim that these links have been written.
      const estimatedRelationships = (
        proposal.data.bundle?.relationships || []
      ).reduce(
        (total: number, rel: any) => total + (types.get(rel.fromType) || 0),
        0,
      );
      return {
        ...counts,
        totalRecords,
        estimatedRelationships,
        sampledAt: Date.now(),
        startedAt,
      };
    } catch {
      // Telemetry must not interrupt a running build or conceal its real status.
      return undefined;
    }
  })();
  entry.value = await entry.pending;
  entry.at = Date.now();
  entry.pending = undefined;
  return entry.value;
}
