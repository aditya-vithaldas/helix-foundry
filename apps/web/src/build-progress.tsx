import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { Resource } from "../../../packages/shared/src";
import { formatCompact } from "./kit/util";
import {
  remainingSeconds,
  remainingLabel,
  type PublicationMeasurement,
} from "./build-estimate";

const stages = [
  ["ontology", "Build records"],
  ["dashboards", "Prepare analytics"],
  ["validation", "Check queries"],
  ["publishing", "Publish workspace"],
] as const;
const stageIndex = (stage: string) =>
  stages.findIndex(([key]) => stage.startsWith(key));

export function BuildProgress({
  run,
  disconnected,
}: {
  run: Resource;
  disconnected: boolean;
}) {
  const [clock, setClock] = useState(Date.now);
  const [samples, setSamples] = useState<PublicationMeasurement[]>([]);
  const [estimate, setEstimate] = useState<{
    runId: string;
    generation: string;
    label: string;
  }>();
  const incoming: PublicationMeasurement | undefined =
    run.data.publicationProgress;
  // A missing poll must not remove the last known counts from the page.
  const measured =
    incoming ||
    samples.findLast(
      (sample) => sample.generation === run.data.publicationGeneration,
    );
  useEffect(() => {
    if (!incoming) return;
    setSamples((previous) => {
      if (previous.at(-1)?.sampledAt === incoming.sampledAt) return previous;
      return [
        ...previous.filter(
          (p) =>
            p.generation === incoming.generation &&
            incoming.sampledAt - p.sampledAt < 60000,
        ),
        incoming,
      ];
    });
  }, [incoming?.sampledAt, incoming?.generation]);
  const working = ["queued", "running"].includes(run.data.status);
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [working]);
  const events: { stage: string; at: string }[] = run.data.events || [];
  const latest = events.findLast((event) => stageIndex(event.stage) >= 0);
  const current = stageIndex(run.data.stage || latest?.stage || "");
  const active = current >= 0 ? current : stageIndex(latest?.stage || "");
  const succeeded = run.data.status === "succeeded";
  const started = Date.parse(run.createdAt);
  const end = working ? clock : Date.parse(run.updatedAt);
  const elapsed = Math.max(0, Math.floor((end - started) / 1000)) || 0;
  const duration = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const remaining =
    measured && !disconnected && working
      ? remainingSeconds(measured, samples, clock)
      : undefined;
  const freshLabel =
    remaining === undefined
      ? undefined
      : remaining > 0
        ? remainingLabel(remaining)
        : "Finishing publication…";
  useEffect(() => {
    if (!freshLabel || !measured) return;
    setEstimate({
      runId: run.id,
      generation: measured.generation,
      label: freshLabel,
    });
  }, [freshLabel, run.id, measured?.generation]);
  const remainingText =
    freshLabel ||
    (estimate?.runId === run.id && estimate.generation === measured?.generation
      ? estimate.label
      : "Remaining: estimating…");
  const recordPercent =
    measured && measured.totalRecords > 0
      ? Math.min(
          100,
          Math.max(
            0,
            Math.floor((100 * measured.records) / measured.totalRecords),
          ),
        )
      : undefined;
  return (
    <section className="build-progress" aria-label="Workspace build progress">
      <div className="build-progress-heading">
        <p role="status">
          {succeeded
            ? "Workspace ready"
            : active < 0
              ? "Waiting to start"
              : `Stage ${active + 1} of ${stages.length}`}
        </p>
        {/* A ticking timer is visual only; stage changes are announced. */}
        <span className="muted" aria-live="off">
          {duration} elapsed
          {working && (
            <>
              {" "}
              /{" "}
              <span title="Approximate total time remaining, including relationships. The last estimate stays visible between measurements.">
                {remainingText}
              </span>
            </>
          )}
        </span>
      </div>
      {working && (
        <>
          <p className="build-record-progress muted" aria-live="off">
            {measured && recordPercent !== undefined
              ? `${formatCompact(measured.records)} / ${formatCompact(measured.totalRecords)} records · ${recordPercent}%`
              : "Measuring progress…"}
            {measured && measured.relationships > 0
              ? ` · ${formatCompact(measured.relationships)} relationships`
              : ""}
          </p>
          <div
            className={`build-activity${disconnected ? " is-paused" : ""}`}
            role="progressbar"
            aria-label="Records created"
            aria-valuemin={recordPercent === undefined ? undefined : 0}
            aria-valuemax={recordPercent === undefined ? undefined : 100}
            aria-valuenow={recordPercent}
            aria-valuetext={
              disconnected
                ? "Reconnecting to build status"
                : recordPercent !== undefined
                  ? `${recordPercent}% of records created; workspace publication continues`
                  : active < 0
                    ? "Waiting to start"
                    : stages[active][1]
            }
          >
            <span style={{ width: `${recordPercent ?? 0}%` }} />
          </div>
        </>
      )}
      <ol className="feed-steps build-stages">
        {stages.map(([key, label], index) => {
          const finished = succeeded || index < active;
          const skipped =
            finished && !events.some((event) => event.stage.startsWith(key));
          const selected = index === active && working;
          return (
            <li
              key={key}
              className={`feed-step is-${finished ? "done" : selected ? "active" : "pending"}`}
              aria-current={selected ? "step" : undefined}
            >
              <span className="feed-step-mark" aria-hidden="true">
                {finished && !skipped && <Check size={10} strokeWidth={3.2} />}
              </span>
              <span>
                {label}
                <small className="build-stage-status">
                  {skipped
                    ? "Not needed"
                    : finished
                      ? "Done"
                      : selected
                        ? "In progress"
                        : index === active
                          ? "Paused"
                          : "Waiting"}
                </small>
              </span>
            </li>
          );
        })}
      </ol>
      {disconnected ? (
        <p className="build-wait-note" role="status">
          Connection interrupted. Reconnecting to build status…
        </p>
      ) : working ? (
        <p className="build-wait-note">
          The build continues in the background. Your workspace opens when
          ready.
        </p>
      ) : null}
    </section>
  );
}
