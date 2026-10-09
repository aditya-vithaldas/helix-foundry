import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { Resource } from "../../../packages/shared/src";

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
        </span>
      </div>
      {working && (
        <div
          className={`build-activity${disconnected ? " is-paused" : ""}`}
          role="progressbar"
          aria-label="Workspace build"
          aria-valuetext={
            disconnected
              ? "Reconnecting to build status"
              : active < 0
                ? "Waiting to start"
                : stages[active][1]
          }
        >
          <span />
        </div>
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
      ) : working && elapsed >= 60 ? (
        <p className="build-wait-note">
          Large datasets can take several minutes. You can leave this page; the
          build continues in the background.
        </p>
      ) : null}
    </section>
  );
}
