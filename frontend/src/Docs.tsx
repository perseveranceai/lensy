// The /docs section: the docs home, the check list and one page per check, plus
// the docs navigation every /docs page shows under the header. The scores page
// (DocsScores), the command line guide (CliGuide) and the checker page (BotInfo)
// live in their own files; site-pages.json lists them all in the "docs" group.
//
// Check pages come from src/checks.json, which scripts/checks-from-docs.mjs
// builds from packages/docs/checks.md, the same text `lensy explain <id>` prints.
import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowRight, Check, Copy } from "lucide-react";
import CHECKS from "./checks.json";
import { NotFound, Page } from "./AppRoutes";
import { Block } from "./CliGuide";
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
  return <Link to={to} className="soft-card group flex h-full flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--accent)]">
    <h3 className="flex items-center justify-between gap-3 text-[16px] font-medium tracking-[-.03em] text-[var(--ink)]">{title}<ArrowRight className="arrow-nudge size-3.5 shrink-0 text-[var(--accent)]" strokeWidth={1.8} aria-hidden="true" /></h3>
    <div className="text-[13px] leading-relaxed text-[var(--ink-soft)]">{children}</div>
  </Link>;
}

/** Copies a command. A button with no aria-expanded, so the Markdown copy leaves it out. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" onClick={() => {
    try {
      navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }, () => undefined);
    } catch { /* no clipboard: the command can still be selected */ }
  }} className="inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] border border-[var(--line)] px-2.5 py-1.5 text-[12px] font-medium tracking-[-.02em] text-[var(--ink-soft)] transition-colors hover:border-[var(--accent)] hover:text-[var(--ink)]">
    {copied ? <Check className="size-3" strokeWidth={2} aria-hidden="true" /> : <Copy className="size-3" strokeWidth={1.8} aria-hidden="true" />}{copied ? "Copied" : "Copy"}
  </button>;
}

function SectionHead({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <div className="max-w-[640px]">
    <h2 id={id} className="scroll-mt-28 text-[clamp(1.6rem,2.6vw,2.2rem)] font-medium leading-[1.05] tracking-[-.05em]">{title}</h2>
    <p className="mt-3 text-[14px] leading-relaxed text-[var(--ink-soft)]">{children}</p>
  </div>;
}

const CLI_COMMAND = "npx @perseverance-ai/lensy@next check https://docs.example.com/guide";
/** The checks people ask about most: the biggest points in each score. */
const POPULAR = ["llms-txt-exists", "rendering-strategy", "markdown-url-support", "http-status-codes", "S1", "S3"];

export function DocsHome() {
  const popular = POPULAR.map((id) => findCheck(id)).filter((x): x is { check: CheckEntry; score: Score } => Boolean(x));
  const step = "border-t border-[var(--line)] py-3.5 pl-1 text-[14px] leading-relaxed text-[var(--ink-soft)] marker:text-[12px] marker:font-medium marker:text-[var(--accent)]";
  return <Page title={<>Lensy{" "}<span className="text-[var(--accent)]">docs.</span></>} intro="Check a documentation page on the website or from your terminal, see what the two scores mean, and fix what they find.">
    <div className="grid gap-16 py-12 sm:gap-20 sm:py-16">

      <section aria-labelledby="start" className="grid gap-8">
        <SectionHead id="start" title="Start here">Pick how you want to check a page. Both give the same two scores, Coding agents and AI search, each out of 100, with the fixes worth the most points first.</SectionHead>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-7">
            <h3 className="text-[19px] font-medium tracking-[-.035em]">On the website</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">Free, with a daily limit on scans. Nothing to install.</p>
            <ol className="mt-5 list-decimal border-b border-[var(--line)] pl-5">
              <li className={step}>Paste the address of one docs page, such as a guide or an API reference.</li>
              <li className={step}>Lensy fetches it the way AI tools do, without running JavaScript, with your robots.txt, sitemap and llms.txt.</li>
              <li className={step}>Read the two scores and fix the top items first.</li>
            </ol>
            <Link to="/#scan" className="btn-ink group mt-6 inline-flex w-fit items-center gap-2 bg-[var(--panel-bg)] px-4 py-3 text-[12px] font-medium tracking-[-.025em] text-[var(--panel-fg)]">Start a free scan <ArrowRight className="arrow-nudge size-3" strokeWidth={1.8} aria-hidden="true" /></Link>
          </div>
          <div className="flex min-w-0 flex-col rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-7">
            <h3 className="text-[19px] font-medium tracking-[-.035em]">From your terminal</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">Open source. Needs Node 22 or newer. Sends nothing about your pages to us.</p>
            <div className="mt-5 min-w-0">
              <Block label="Check a page from your terminal">{CLI_COMMAND}</Block>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <CopyButton text={CLI_COMMAND} />
              <span className="text-[13px] leading-relaxed text-[var(--ink-soft)]">Also checks a local build before you publish, and runs in CI.</span>
            </div>
            <Link to="/docs/cli" className="group mt-6 inline-flex w-fit items-center gap-2 border-b border-[var(--ink)] pb-1 text-[12px] font-medium tracking-[-.025em] text-[var(--ink)]">Read the command line guide <ArrowRight className="arrow-nudge size-3" strokeWidth={1.8} aria-hidden="true" /></Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="browse" className="grid gap-8">
        <SectionHead id="browse" title="Browse the docs">Everything Lensy measures is written down here: how the two scores add up, what each check looks for and why it matters, every command line option, and how to let the checker through your bot protection.</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card to="/docs/scores" title="How Lensy scores a page">What Lensy fetches, how the two scores add up, and how a local build is scored.</Card>
          <Card to="/docs/checks" title="Every check">All {entries("aiSearch").length + entries("codingAgents").length + entries("fallback").length} checks, each with its points, what it measures and the evidence.</Card>
          <Card to="/docs/cli" title="Command line tool">Install, check pages and local builds, save and compare runs, exit codes for CI.</Card>
          <Card to="/docs/bot" title="The Lensy checker">Its user agent and IP address, and how to allow or block it on your site.</Card>
        </div>
      </section>

      <section aria-labelledby="popular" className="grid gap-8">
        <SectionHead id="popular" title="Checks people look up most">These carry the most points, so fixing them usually moves a score the furthest. Each page says what the check measures, why it matters and how it adds to the score.</SectionHead>
        <ul className="grid gap-x-8 border-t border-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">
          {popular.map(({ check, score }) => <li key={check.id} className="border-b border-[var(--line)]">
            <Link to={`/docs/checks/${check.slug}`} className="group flex items-baseline justify-between gap-4 py-4">
              <span className="text-[15px] tracking-[-.03em] text-[var(--ink)] transition-colors group-hover:text-[var(--accent)]">{check.label}</span>
              {" "}
              <span className="shrink-0 text-[12px] tabular-nums text-[var(--muted)]">{score === "aiSearch" ? `AI search, ${check.points} pts` : `Coding agents, weight ${check.weight}`}</span>
            </Link>
          </li>)}
        </ul>
      </section>

      <section aria-labelledby="help" className="grid gap-6 border-t border-[var(--line)] pt-10 sm:pt-12 lg:grid-cols-12">
        <h2 id="help" className="text-[clamp(1.6rem,2.6vw,2.2rem)] font-medium leading-[1.05] tracking-[-.05em] lg:col-span-4">Get help</h2>
        <div className="prose-lensy max-w-[640px] text-[14px] lg:col-span-8">
          <p>Found a problem with the command line tool? <a className={link} href="https://github.com/perseveranceai/lensy/issues/new?template=cli-bug.yml">Open an issue on GitHub</a>; the form asks for your version and the command you ran. For anything else, email <a className={link} href="mailto:hello@perseveranceai.com">hello@perseveranceai.com</a>. What changed recently is in the <Link className={link} to="/changelog">changelog</Link>.</p>
        </div>
      </section>
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
