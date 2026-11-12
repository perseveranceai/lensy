import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Page } from "./AppRoutes";

// /changelog: user-visible changes to Lensy, newest first. One entry per change a
// visitor or CLI user would notice; internal work (CI, infrastructure) stays out.
// Add new entries at the top, and update "updated" for /changelog in site-pages.json.

type Entry = { date: string; items: ReactNode[] };

const link = "text-[var(--ink)] underline underline-offset-2 hover:text-[var(--accent)]";

const MONTHS: { month: string; entries: Entry[] }[] = [
  {
    month: "November 2026",
    entries: [
      { date: "2026-11-12", items: [
        <>New <Link to="/docs" className={link}>docs</Link>: how Lensy scores a page, the command line guide, the Lensy checker, and a page for <Link to="/docs/checks" className={link}>every check</Link> with what it measures and the evidence behind it.</>,
        <>Articles moved to <Link to="/learn" className={link}>Learn</Link>. Old addresses, such as /cli, /bot and /education, redirect to the new ones.</>,
        "The home page example shows our own scores before and after we fixed what Lensy found.",
      ] },
      { date: "2026-11-11", items: [
        <>The full list of checks, with the points for each, is in the <Link to="/docs/checks" className={link}>docs</Link>.</>,
        "The home page shows a real example result, and this site's own Lensy score over time.",
      ] },
      { date: "2026-11-10", items: [
        "Canonical links and meta robots tags written without quotes, as minified HTML does, are now detected.",
        "When robots.txt names no sitemap, Lensy also tries the page's sitemap link, sitemap-index.xml, and sitemaps under the page's first folder, such as /docs/sitemap.xml.",
      ] },
      { date: "2026-11-08", items: [
        <>Command line tool 0.2.0: check a local docs build with <code>--dir</code>, <code>--site-url</code> and <code>--all</code>.</>,
      ] },
      { date: "2026-11-07", items: [
        <>Command line tool 0.1.0 on npm. It shows what to fix first by default, has <code>--verbose</code> and <code>--json</code>, and can save each run in <code>.lensy/</code> to compare with the last one.</>,
      ] },
      { date: "2026-11-06", items: [
        <>New <Link to="/docs/cli" className={link}>command line guide</Link>.</>,
      ] },
      { date: "2026-11-05", items: [
        "The Coding agents score is built on AFDocs, the open Agent-Friendly Documentation checks, plus one Lensy check for headings. The website and the command line tool give the same score.",
      ] },
      { date: "2026-11-01", items: [
        <>Scans come from one fixed IP address, published on the <Link to="/docs/bot" className={link}>Lensy checker page</Link>, so site owners can allow Lensy safely.</>,
      ] },
    ],
  },
  {
    month: "October 2026",
    entries: [
      { date: "2026-10-25", items: [
        "Report fixes: each fix is listed once, and the PDF keeps headings with their content.",
      ] },
      { date: "2026-10-22", items: [
        "Two scores replace the single readiness score: Coding agents and AI search, each out of 100, with a reachability line above them.",
        "Lensy fetches pages with its own honest user agent first, and says so when a site's bot protection blocks it.",
        "Bare hostnames such as docs.python.org are accepted.",
      ] },
      { date: "2026-10-21", items: [
        <>A cookie banner: analytics load only if you accept. A rewritten <Link to="/legal/privacy" className={link}>privacy policy</Link>, and scan files deleted after 30 days.</>,
      ] },
      { date: "2026-10-13", items: [
        "Download the report as Markdown or PDF.",
      ] },
    ],
  },
  {
    month: "September 2026",
    entries: [
      { date: "2026-09-16", items: [
        <>Lensy&apos;s detection was re-checked against how docs sites really publish Markdown and llms.txt. The details are in <Link to="/learn/what-changed-in-lensy-after-rechecking-ai-ready-docs-signals" className={link}>What changed in Lensy after re-checking AI-ready docs signals</Link>.</>,
        "Documentation built with DITA and AEM is no longer rejected as not being documentation.",
      ] },
    ],
  },
];

function formatDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function Changelog() {
  return <Page
    titleStyle={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}
    title={<>What&apos;s{" "}<br /><span className="text-[var(--accent)]">new.</span></>}
    intro="Changes to the Lensy scanner, its checks and the command line tool that you would notice, newest first."
  >
    <div className="prose-lensy max-w-[760px] py-12 sm:py-16">
      {MONTHS.map(({ month, entries }) => <section key={month}>
        <h2>{month}</h2>
        {entries.map((e) => <div key={e.date} className="not-prose mt-5 grid gap-x-6 gap-y-1 sm:grid-cols-[72px_minmax(0,1fr)]">
          <p className="pt-0.5 text-[12px] font-medium text-[var(--muted)]"><time dateTime={e.date}>{formatDay(e.date)}</time></p>
          <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[15px] leading-relaxed text-[var(--ink-soft)] marker:text-[var(--line-strong)]">
            {e.items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>)}
      </section>)}
    </div>
  </Page>;
}
