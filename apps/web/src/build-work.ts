import type { PublicationMeasurement } from "./build-estimate";

// Rough duration shares stay fixed throughout a generation. Counts remain the
// authoritative measurements; final checks reserve the last part of the bar.
export function buildWork(
  p: PublicationMeasurement | undefined,
  ready: boolean,
) {
  if (ready) return { percent: 100, remaining: "Workspace ready" };
  if (!p || p.totalRecords <= 0)
    return { percent: undefined, remaining: "Remaining: preparing the build" };
  const records = Math.min(1, Math.max(0, p.records / p.totalRecords));
  const links =
    p.estimatedRelationships > 0
      ? Math.min(1, Math.max(0, p.relationships / p.estimatedRelationships))
      : 1;
  return {
    percent: Math.floor(
      p.estimatedRelationships > 0 ? 25 * records + 70 * links : 95 * records,
    ),
    remaining:
      records < 1
        ? "Remaining: records, relationships and final checks"
        : links < 1
          ? "Remaining: relationships and final checks"
          : "Remaining: final checks",
  };
}

export function retainMeasurement(
  previous: PublicationMeasurement | undefined,
  incoming: PublicationMeasurement | undefined,
  generation: string | undefined,
) {
  const old = previous?.generation === generation ? previous : undefined;
  if (!incoming || incoming.generation !== generation) return old;
  if (!old) return incoming;
  if (incoming.sampledAt < old.sampledAt) return old;
  return {
    ...incoming,
    totalRecords: old.totalRecords,
    estimatedRelationships: old.estimatedRelationships,
    records: Math.max(old.records, incoming.records),
    relationships: Math.max(old.relationships, incoming.relationships),
  };
}
