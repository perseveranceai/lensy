import { Link } from "react-router-dom";
import { Page } from "./AppRoutes";
import { BASELINE, formatRunDate, latestRun, ScoreChart, useReadinessHistory } from "./readiness";

// /ai-readiness: this site's own scores, checked weekly by
// .github/workflows/site-readiness.yml with the Lensy CLI.
// Spec: .context/specs/site-architecture.md (phase 2).

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] px-5 py-4">
    <p className="text-[12px] font-medium tracking-[-.02em] text-[var(--muted)]">{label}</p>
    <p className="mt-2 flex items-baseline gap-1.5"><span className="text-[44px] font-medium leading-none tracking-[-.05em] text-[var(--ink)] tabular-nums">{value}</span><span className="text-[13px] text-[var(--muted)]">out of 100</span></p>
  </div>;
}

export function AiReadiness() {
  const history = useReadinessHistory();
  const latest = latestRun(history);
  return <Page
    titleStyle={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}
    title={<>Our own{" "}<br /><span className="text-[var(--accent)]">AI readiness.</span></>}
    intro="Every Monday we run the Lensy command line tool on each page of this site and publish the scores here, including any week they drop."
  >
    <div className="prose-lensy max-w-[860px] py-12 sm:py-16">
      <h2>Latest run</h2>
      <div className="grid gap-3 sm:grid-cols-2" data-testid="readiness-latest">
        <Stat label="Coding agents" value={latest.codingAgents} />
        <Stat label="AI search" value={latest.aiSearch} />
      </div>
      <p>Checked on <time dateTime={latest.date}>{formatRunDate(latest.date)}</time> across {latest.pages.length} page{latest.pages.length === 1 ? "" : "s"}, with lensy {latest.cli || "CLI"}. Each score is the average of the pages checked that week.{latest.notChecked?.length ? ` These pages couldn't be checked that week: ${latest.notChecked.join(", ")}.` : ""}</p>

      <h2>Score history</h2>
      <p>One point per weekly run. Hover over the chart, or focus it and use the arrow keys, to read a run. A small mark above a point means Lensy&apos;s own checks changed that week, so a move then can come from the new checks rather than from a change to this site.</p>
      <ScoreChart runs={history.runs} />

      <h2>Every page</h2>
      <p>Scores from the latest run, out of 100, for each page in this site&apos;s sitemap.</p>
      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--line)]">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead className="bg-[var(--surface)] text-[12px] text-[var(--muted)]">
            <tr><th className="px-4 py-2.5 font-medium">Page</th><th className="px-3 py-2.5 text-right font-medium sm:px-4">Coding agents</th><th className="px-3 py-2.5 text-right font-medium sm:px-4">AI search</th></tr>
          </thead>
          <tbody>
            {latest.pages.map((p) => <tr key={p.path} className="border-t border-[var(--line)]">
              <td className="px-4 py-2.5"><Link to={p.path} className="break-all">{p.path}</Link></td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[var(--ink)] sm:px-4">{p.codingAgents}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[var(--ink)] sm:px-4">{p.aiSearch}</td>
            </tr>)}
          </tbody>
        </table>
      </div>

      <h2>How we measure</h2>
      <p>A scheduled GitHub Actions job reads this site&apos;s sitemap.xml, runs the open source Lensy command line tool on every address in it, and adds the result to a history file that this page reads. It uses the same checks and the same scoring as a scan on this site, and it fetches pages as <code>lensy-cli</code>, the user agent described on the <Link to="/bot">bot page</Link>.</p>
      <p>The first run, on {formatRunDate(BASELINE.date)}, was taken before we rebuilt the site so that crawlers could read it. Every page reached them as an empty JavaScript shell, and the {BASELINE.pages.length} pages we checked scored {BASELINE.codingAgents} for coding agents and {BASELINE.aiSearch} for AI search.</p>
      <p>You can run the same check on any page of this site:</p>
      <pre tabIndex={0} aria-label="The check this page runs" className="overflow-x-auto rounded-[var(--radius-md)] px-[18px] py-4 text-[13px] leading-[1.7]" style={{ background: "var(--panel-bg)", color: "var(--panel-fg)", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
        <code style={{ background: "transparent", padding: 0, color: "inherit", fontSize: "inherit" }}>npx @perseverance-ai/lensy@next check https://perseveranceai.com/</code>
      </pre>
      <p>To check your own documentation, <Link to="/#scan">start a free scan</Link> or read the <Link to="/cli">command line guide</Link>.</p>
    </div>
  </Page>;
}
