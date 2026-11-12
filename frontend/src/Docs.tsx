// The /docs section: the docs home, the check list and one page per check, plus
// the docs navigation every /docs page shows under the header. The scores page
// (DocsScores), the command line guide (CliGuide) and the checker page (BotInfo)
// live in their own files; site-pages.json lists them all in the "docs" group.
//
// Check pages come from src/checks.json, which scripts/checks-from-docs.mjs
// builds from packages/docs/checks.md, the same text `lensy explain <id>` prints.
import { Fragment } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import CHECKS from "./checks.json";
import { NotFound, Page } from "./AppRoutes";
import { breadcrumbFor, pagesInGroup } from "./site";
import { usePageMeta } from "./usePageMeta";

const code = "rounded-[var(--radius-xs)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[13px]";
const link = "text-[var(--accent)] underline underline-offset-2";

/** Text from checks.md with `code` spans. */
export function Inline({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/).map((part, i) => part.startsWith("`") && part.endsWith("`")
    ? <code key={i} className={code}>{part.slice(1, -1)}</code>
    : <Fragment key={i}>{part}</Fragment>)}</>;
}

type Score = "codingAgents" | "fallback" | "aiSearch";
interface CheckEntry {
  id: string;
  slug: string;
  label: string;
  source?: string;
  weight?: number;
  points?: number;
  measures: string;
  why: string;
  host?: string;
  evidence: { title: string; url: string }[];
}

const GROUPS: { score: Score; title: string; unit: "Weight" | "Points"; intro: string }[] = [
  {
    score: "aiSearch",
    title: "AI search",
    unit: "Points",
    intro: "Six checks worth 100 points between them. Each check gives full, partial or no points.",
  },
  {
    score: "codingAgents",
    title: "Coding agents",
    unit: "Weight",
    intro: CHECKS.intro.codingAgents,
  },
  {
    score: "fallback",
    title: "Coding agents without AFDocs",
    unit: "Points",
    intro: "If AFDocs can't run on a page, the Coding agents score comes from these six Lensy checks instead, worth 100 points between them.",
  },
];

const entries = (score: Score) => (CHECKS[score] as CheckEntry[]);
const value = (c: CheckEntry) => c.weight ?? c.points ?? 0;

/** How a check adds to its score, from the same rules /docs/scores explains. */
function howItCounts(check: CheckEntry, score: Score): string {
  if (score === "aiSearch") {
    return `${check.id} is one of six AI search checks, worth ${check.points} of the score's 100 points. It gives full, partial or no points, and the AI search score is the sum of the six. A page that can't be reached at all gets no score; the reachability line above both scores says why.`;
  }
  if (score === "fallback") {
    return `${check.id} counts only when AFDocs can't run on a page. Then the Coding agents score comes from six Lensy checks, C1 to C6, worth 100 points between them, and this one is worth ${check.points}. It gives full, partial or no points.`;
  }
  const source = check.source === "Lensy"
    ? "This is Lensy's own check, scored alongside the AFDocs checks."
    : "This is an AFDocs check, from the open Agent-Friendly Documentation checks; the description above is AFDocs' own.";
  return `${source} It has a weight of ${check.weight} in the Coding agents score (critical 10, high 7, medium 4, low 2). A pass earns the full weight and a warning earns part of it. The score is the weight earned over the weight of the checks that ran, out of 100, and with no llms.txt it is at most 59.`;
}

export function findCheck(slug: string): { check: CheckEntry; score: Score } | null {
  for (const g of GROUPS) {
    const check = entries(g.score).find((c) => c.slug === slug.toLowerCase());
    if (check) return { check, score: g.score };
  }
  return null;
}

/** The links under the header on every /docs page. A <nav>, so the Markdown copies leave it out. */
export function DocsNav() {
  const { pathname } = useLocation();
  const items = [{ path: "/docs", label: "Overview" }, ...pagesInGroup("docs").map((p) => ({ path: p.path, label: p.label }))];
  return <nav aria-label="Docs" className="border-b border-[var(--line-soft)]">
    <ul className="mx-auto flex max-w-[1240px] gap-1 overflow-x-auto px-5 py-2 text-[12px] font-medium tracking-[-.02em] sm:px-8">
      {items.map((item) => {
        const active = item.path === "/docs" ? pathname === "/docs" : pathname === item.path || pathname.startsWith(item.path + "/");
        return <li key={item.path} className="shrink-0">
          <Link to={item.path} aria-current={active ? "page" : undefined}
            className={`inline-flex rounded-[var(--radius-xs)] px-2.5 py-1.5 transition-colors ${active ? "bg-[var(--surface-2)] text-[var(--ink)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"}`}>{item.label}</Link>
        </li>;
      })}
    </ul>
  </nav>;
}

function Card({ to, title, children }: { to: string; title: string; children: ReactNode }) {
  return <Link to={to} className="soft-card group flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--line)] p-5 transition-colors hover:border-[var(--accent)]">
    <span className="flex items-center justify-between gap-3 text-[16px] font-medium tracking-[-.03em] text-[var(--ink)]">{title}<ArrowRight className="arrow-nudge size-3.5 text-[var(--accent)]" strokeWidth={1.8} aria-hidden="true" /></span>
    <span className="text-[13px] leading-relaxed text-[var(--ink-soft)]">{children}</span>
  </Link>;
}

export function DocsHome() {
  return <Page title={<>Lensy{" "}<span className="text-[var(--accent)]">docs.</span></>} intro="Check a documentation page on the website or from your terminal, see what the two scores mean, and fix what they find.">
    <article className="legal-prose prose-lensy max-w-[760px] py-12 sm:py-16">
      <h2>Check a page on the website</h2>
      <ol>
        <li>Paste the address of one documentation page, such as a guide or an API reference, into the box on the <Link to="/#scan">home page</Link>.</li>
        <li>Lensy fetches the page the way AI tools do, without running JavaScript, along with your robots.txt, sitemap and llms.txt.</li>
        <li>You get a Coding agents score and an AI search score, each out of 100, and the fixes worth the most points first.</li>
      </ol>
      <p>The website is free, with a daily limit on scans.</p>

      <h2>Check pages from your terminal</h2>
      <p>The open source <code className={code}>lensy</code> command gives the same two scores. It needs Node 22 or newer:</p>
      <pre><code>npx @perseverance-ai/lensy@next check https://docs.example.com/guide</code></pre>
      <p>It checks live pages or a local build, runs in CI, and sends nothing about your pages to us. The <Link to="/docs/cli">command line guide</Link> covers every option.</p>

      <h2>Understand the scores</h2>
      <p><strong>Coding agents</strong> is how well tools such as Claude Code and Cursor can find and read the page. <strong>AI search</strong> is how well ChatGPT search, Perplexity and Claude can find the page and cite it. <Link to="/docs/scores">How Lensy scores a page</Link> explains both, and <Link to="/docs/checks">every check</Link> has its own page with what it measures, why it matters and the evidence behind it.</p>

      <h2>Let the checker in</h2>
      <p>If your site blocks bots, a scan may be refused. <Link to="/docs/bot">The Lensy checker</Link> page gives its user agent and IP address, and how to allow or block it.</p>

      <h2>Get help</h2>
      <p>Found a problem with the command line tool? <a className={link} href="https://github.com/perseveranceai/lensy/issues/new?template=cli-bug.yml">Open an issue on GitHub</a>. For anything else, email <a className={link} href="mailto:hello@perseveranceai.com">hello@perseveranceai.com</a>.</p>
    </article>
    <div data-md-skip="true" className="grid gap-4 pb-16 sm:grid-cols-2 lg:grid-cols-4">
      <Card to="/docs/scores" title="How Lensy scores a page">The two scores, the reachability line and local builds.</Card>
      <Card to="/docs/checks" title="Every check">{entries("aiSearch").length + entries("codingAgents").length} checks, each with its points and evidence.</Card>
      <Card to="/docs/cli" title="Command line tool">Install, check pages and builds, save and compare runs.</Card>
      <Card to="/docs/bot" title="The Lensy checker">User agent, IP address, allow or block it.</Card>
    </div>
  </Page>;
}

function CheckTable({ score, title, intro, unit }: { score: Score; title: string; intro: string; unit: string }) {
  return <section aria-labelledby={`checks-${score}`} className="min-w-0">
    <h2 id={`checks-${score}`} className="text-[19px] font-medium tracking-[-.035em]">{title}</h2>
    <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[var(--ink-soft)]">{intro}</p>
    <div className="mt-4 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--line)]">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead className="bg-[var(--surface)] text-[12px] text-[var(--muted)]">
          <tr><th scope="col" className="px-3 py-2.5 font-medium sm:px-4">Check</th><th scope="col" className="hidden px-3 py-2.5 font-medium sm:table-cell sm:px-4">ID</th><th scope="col" className="px-3 py-2.5 text-right font-medium sm:px-4">{unit}</th></tr>
        </thead>
        <tbody>
          {entries(score).map((c) => <tr key={c.id} className="border-t border-[var(--line)]">
            <td className="px-3 py-2 sm:px-4"><Link to={`/docs/checks/${c.slug}`} className="link-sweep text-[var(--ink)] hover:text-[var(--accent)]">{c.label}</Link></td>
            <td className="hidden px-3 py-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--muted)] sm:table-cell sm:px-4">{c.id}</td>
            <td className="px-3 py-2 text-right tabular-nums text-[var(--ink)] sm:px-4">{value(c)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}

export function DocsChecks() {
  return <Page title={<>Every{" "}<span className="text-[var(--accent)]">check.</span></>} intro="The checks behind both scores, from the same check registry the scanner and the command line tool use, so this list changes when they do.">
    <div className="grid gap-12 py-12 sm:py-16">
      <p className="prose-lensy max-w-[760px] text-[15px] leading-relaxed text-[var(--ink-soft)]">Each check links to what it measures, why it matters and the evidence behind it. In a terminal, <code className={code}>lensy explain &lt;id&gt;</code> prints the same text. <Link className={link} to="/docs/scores">How Lensy scores a page</Link> explains how the checks add up.</p>
      {GROUPS.map((g) => <CheckTable key={g.score} score={g.score} title={g.title} intro={g.intro} unit={g.unit} />)}
    </div>
  </Page>;
}

export function CheckPage() {
  const { slug = "" } = useParams();
  const found = findCheck(slug);
  const group = found ? GROUPS.find((g) => g.score === found.score)! : null;
  const path = found ? `/docs/checks/${found.check.slug}` : "";
  usePageMeta(found ? {
    path,
    title: `${found.check.label} (${found.check.id}): ${group!.title} check`,
    description: `What the ${found.check.label} check measures, why it matters for ${found.score === "aiSearch" ? "AI search" : "coding agents"}, and the evidence behind it. Worth ${value(found.check)} ${group!.unit.toLowerCase()} in the ${group!.title} score.`,
    schema: "TechArticle",
    updated: "2026-11-12",
    markdown: true,
    breadcrumb: breadcrumbFor(path, found.check.label),
  } : null);
  if (!found || !group) return <NotFound />;
  const { check } = found;
  const siblings = entries(found.score);
  const index = siblings.findIndex((c) => c.id === check.id);
  const prev = siblings[index - 1];
  const next = siblings[index + 1];
  return <Page title={check.label} intro={`${group.title} check ${check.id}, worth ${value(check)} ${group.unit.toLowerCase()}${check.source ? ` (${check.source})` : ""}.`} titleStyle={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
    <article className="legal-prose prose-lensy max-w-[760px] py-12 sm:py-16">
      <h2>What it measures and why</h2>
      <p><Inline text={check.measures} /></p>
      <p><Inline text={check.why} /></p>
      {check.evidence.length > 0 && <>
        <p>Evidence:</p>
        <ul>{check.evidence.map((e) => <li key={e.url}><a href={e.url} target="_blank" rel="noopener noreferrer">{e.title}</a></li>)}</ul>
      </>}
      <h2>How it counts</h2>
      <p>{howItCounts(check, found.score)}</p>
      {check.host && <p><strong>Depends on your hosting.</strong> <Inline text={check.host} /></p>}
      <h2>Check it yourself</h2>
      <p>Scan the page on the <Link to="/#scan">home page</Link>, or run <code className={code}>lensy check &lt;url&gt;</code> from the <Link to="/docs/cli">command line tool</Link> and look for <code className={code}>{check.id}</code> in the report. A failed check comes with the fix worth the most points first. <code className={code}>lensy explain {check.id}</code> prints what it measures, why it matters and the evidence in your terminal, and <Link to="/docs/checks">every check</Link> lists the rest.</p>
    </article>
    <nav aria-label="More checks" className="grid border-t border-[var(--line)] sm:grid-cols-2">
      {prev ? <Link to={`/docs/checks/${prev.slug}`} className="flex flex-col gap-1 py-6 pr-8 text-[var(--ink-soft)] hover:text-[var(--accent)]"><span className="text-[11px] text-[var(--muted)]">Previous</span><span className="text-[15px] tracking-[-.03em]">{prev.label}</span></Link> : <span />}
      {next ? <Link to={`/docs/checks/${next.slug}`} className="flex flex-col gap-1 py-6 text-right text-[var(--ink-soft)] hover:text-[var(--accent)] sm:pl-8"><span className="text-[11px] text-[var(--muted)]">Next</span><span className="text-[15px] tracking-[-.03em]">{next.label}</span></Link> : <span />}
    </nav>
    <p className="pb-16 pt-2 text-[13px]"><Link to="/docs/checks" className={link}>All checks</Link></p>
  </Page>;
}
