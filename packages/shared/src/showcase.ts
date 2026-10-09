export type ShowcaseFinding = {
  id: string;
  title: string;
  datasetId: string;
  dataset: string;
  version: string;
  sql: string;
  format: "number" | "currency" | "percent";
  current: number;
  previous: number;
  baseline: number | null;
  delta: number;
  changePercent: number | null;
  baselinePercent: number | null;
  direction: "up" | "down";
  changed: boolean;
};
export type Showcase = {
  status: "ready" | "empty" | "insufficient" | "failed";
  signature: string;
  computedAt?: string;
  weekStart: string;
  weekEnd: string;
  previousStart: string;
  baselineStart: string;
  timezone: "UTC";
  findings: ShowcaseFinding[];
  measured: number;
  skipped: number;
  // Metrics whose query failed; the report is retried after a pause.
  failed: number;
  // Datasets with no records on the comparison week's last day or later, so
  // their metrics are left out rather than shown as a drop.
  stalled?: { datasetId: string; dataset: string; lastDate: string }[];
  error?: string;
  stale?: boolean;
};
