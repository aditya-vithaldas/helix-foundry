import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, RefreshCw, Sparkles } from "lucide-react";
import type { Showcase } from "../../../../../packages/shared/src/showcase";
import { api } from "../../api";
import { useWorkspace } from "../../ui";
import { Button, ButtonLink, EmptyState, Page, PageHeader, Panel, Skeleton } from "../../kit";
import { useAskAnalyst } from "../analyst/launcher";
import { paths } from "../../paths";
import "./showcase.css";

const number = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
const percent = (n: number | null) => n === null ? "No percentage: earlier value was zero" : `${n > 0 ? "+" : ""}${number(n)}%`;

export function ShowcasePage() {
  const { id } = useWorkspace(), ask = useAskAnalyst();
  const [opening, setOpening] = useState<string | null>(null);
  const query = useQuery({
    queryKey: [id, "showcase"],
    queryFn: () => api<Showcase>(`/workspaces/${id}/showcase`),
    refetchInterval: 20000,
  });
  const report = query.data;
  return <Page className="sc-page">
    <PageHeader title="Proactive Showcase" eyebrow="Your weekly briefing"
      subtitle="What changed last week—and how it compares with the recent trend."
      icon={<Sparkles size={22} />}
      actions={<Button size="sm" icon={RefreshCw} disabled={query.isFetching} onClick={() => void query.refetch()}>Check for updates</Button>}
      meta={report && <span>{report.weekStart} → {report.weekEnd} (end excluded) · UTC · {report.computedAt ? `Updated ${new Date(report.computedAt).toLocaleString()}` : "Awaiting analysis"}</span>} />
    {(query.error || report?.error) && <div className="sc-notice" role="alert">{report?.error || "Couldn’t reach the showcase. Retrying automatically."}</div>}
    {!report && query.isPending && <Skeleton height={200} />}
    {report && <>
      <p className="sc-context">Compared with the week starting {report.previousStart}. The baseline is the weekly average of the four preceding weeks. Highlights show changes of at least 10%, or a move from zero. Values describe observed records; they do not prove complete source coverage or explain causes.</p>
      {!!report.findings.length && <div className="sc-findings">
        {report.findings.map(f => {
          const Icon = f.direction === "up" ? ArrowUpRight : ArrowDownRight;
          return <Panel key={f.id} title={f.title} subtitle={f.dataset}
            actions={f.changed && <span className="sc-badge">New or changed</span>}>
            <div className="sc-change"><Icon size={26} aria-hidden /><strong>{percent(f.changePercent)}</strong></div>
            <p>{f.title} {f.direction === "up" ? "increased" : "decreased"} by {number(Math.abs(f.delta))} compared with the previous week.</p>
            <dl className="sc-values">
              <div><dt>Last week</dt><dd>{number(f.current)}</dd></div>
              <div><dt>Previous week</dt><dd>{number(f.previous)}</dd></div>
              <div><dt>Four-week average</dt><dd>{f.baseline === null ? "Insufficient history" : number(f.baseline)}</dd></div>
            </dl>
            {f.baseline !== null && <p className="sc-baseline">{percent(f.baselinePercent)} versus the four-week average.</p>}
            {f.format === "currency" && <p className="sc-baseline">Amounts are in source units, converted from cents where defined. Currency is not inferred.</p>}
            <div className="sc-actions">
              <Button size="sm" disabled={opening !== null} onClick={async () => {
                setOpening(f.id);
                try { await ask({resourceId: f.datasetId, prompt: `Investigate "${f.title}" in ${f.dataset} for ${report.weekStart} to ${report.weekEnd} exclusive (UTC), compared with the week starting ${report.previousStart} and four preceding weeks. Showcase observed ${f.current} versus ${f.previous}, baseline ${f.baseline ?? "unavailable"}, using snapshot ${f.version}. Check the current snapshot and disclose if it changed. Explain contributing records with query evidence; distinguish observations from possible causes.`}); }
                finally { setOpening(null); }
              }}>{opening === f.id ? "Opening…" : "Explore with Analyst"}</Button>
              <ButtonLink size="sm" variant="ghost" to={paths.dataset(f.datasetId)}>Open data</ButtonLink>
            </div>
            <details className="sc-evidence"><summary>Query evidence</summary><p>Snapshot: {f.version}</p><pre>{f.sql}</pre></details>
          </Panel>;
        })}
      </div>}
      {!report.findings.length && !report.error && <EmptyState icon={Sparkles}
        title={report.status === "empty" ? "Connect data to get your briefing" : report.status === "insufficient" ? (report.stalled?.length ? "Last week’s data isn’t complete yet" : "More weekly history needed") : "No notable weekly changes"}
        text={report.status === "ready" ? `${report.measured} metrics compared; none crossed the highlight threshold.` : "Add dated records covering the comparison weeks. Highlights appear automatically when suitable snapshots are available."}
        action={<ButtonLink to={paths.data()}>Open Data</ButtonLink>} />}
      {!!report.stalled?.length && <p className="sc-context">Left out because the records stop before the end of last week, which would read as a drop: {report.stalled.map((s, i) => <span key={s.datasetId}>{i ? ", " : ""}<Link to={paths.dataset(s.datasetId)}>{s.dataset}</Link> (latest record {s.lastDate})</span>)}. Check that the source is still syncing.</p>}
      {!!report.failed && <p className="sc-context">{report.failed} {report.failed === 1 ? "metric" : "metrics"} couldn’t be calculated and will be retried automatically.</p>}
      {!!report.skipped && <p className="sc-context">{report.skipped} metrics omitted because their date history or definition could not support this comparison.</p>}
    </>}
  </Page>;
}
