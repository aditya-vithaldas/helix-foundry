export type PublicationMeasurement = {
  generation: string;
  records: number;
  relationships: number;
  totalRecords: number;
  estimatedRelationships: number;
  sampledAt: number;
  startedAt: string;
};

export function remainingSeconds(
  current: PublicationMeasurement,
  samples: PublicationMeasurement[],
  now: number,
) {
  if (now - current.sampledAt > 20000 || current.totalRecords <= 0) return;
  const completed = (p: PublicationMeasurement) => p.records + p.relationships;
  const first = samples.find((p) => p.generation === current.generation);
  const recent = first && current.sampledAt - first.sampledAt >= 15000;
  const seconds =
    (current.sampledAt -
      (recent ? first.sampledAt : Date.parse(current.startedAt))) /
    1000;
  if (seconds < 15) return;
  const processed = completed(current) - (recent ? completed(first) : 0);
  if (processed <= 0) return;
  const remaining =
    Math.max(0, current.totalRecords - current.records) +
    Math.max(0, current.estimatedRelationships - current.relationships);
  return remaining / (processed / seconds);
}

export function remainingLabel(seconds: number) {
  const minutes = seconds / 60;
  if (minutes < 1) return "About a minute remaining";
  if (minutes >= 90) {
    const hours = (scale: number) =>
      Math.max(0.5, Math.ceil((minutes * scale) / 30) / 2);
    return `About ${hours(0.75)}–${hours(1.5)} hours remaining`;
  }
  const round = (n: number) =>
    Math.max(
      1,
      Math.ceil(n / (minutes >= 10 ? 5 : 1)) * (minutes >= 10 ? 5 : 1),
    );
  const low = round(minutes * 0.75),
    high = round(minutes * 1.5);
  return `About ${low}–${high} minutes remaining`;
}
