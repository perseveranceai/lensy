import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Page } from "./AppRoutes";

// /cli: how to run the Lensy command line tool. Every command and every piece of
// output on this page was run with the packed @perseverance-ai/lensy package, and
// packages/cli/test/guide.test.ts fails when a CLI option is missing from this
// file. Spec: .context/specs/cli-docs-page.md.

const SECTIONS: [string, string][] = [
  ["what-it-is", "What it is"],
  ["install", "Install"],
  ["check-a-page", "Check a page"],
  ["check-several-pages", "Check several pages"],
  ["reports", "Save a report"],
  ["explain", "Explain a check"],
  ["exit-codes", "Exit codes"],
  ["what-it-sends", "What it sends"],
  ["not-yet", "What it can't do yet"],
];

// A command or sample output. It scrolls sideways inside its own box, so a long
// line never widens the page, and it takes keyboard focus so it can be scrolled
// without a mouse.
function Block({ label, children }: { label: string; children: string }) {
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className="overflow-x-auto rounded-[var(--radius-md)] px-[18px] py-4 text-[13px] leading-[1.7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]"
      style={{ background: "var(--panel-bg)", color: "var(--panel-fg)", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
    >
      <code style={{ background: "transparent", padding: 0, color: "inherit", fontSize: "inherit" }}>{children}</code>
    </pre>
  );
}

const H2 = ({ id, children }: { id: string; children: ReactNode }) => (
  <h2 id={id} className="scroll-mt-28">{children}</h2>
);

export function CliGuide() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Command-line guide - Lensy";
    return () => { document.title = previous; };
  }, []);

  return (
    <Page
      title={<>Lensy<br /><span className="text-[var(--accent)]">command line.</span></>}
      intro="Check a docs page from your terminal or your CI. You get the same two scores as perseveranceai.com, and the same fixes."
    >
      <div className="grid gap-10 py-12 sm:py-16 lg:grid-cols-12 lg:gap-16">
        <aside className="hidden lg:col-span-3 lg:block lg:sticky lg:top-28 lg:self-start">
          <p className="text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]">On this page</p>
          <nav className="mt-4 flex flex-col border-y border-[var(--line)] py-1.5" aria-label="On this page">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-[var(--radius-xs)] px-3 py-2 text-[13px] text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--ink)]">{label}</a>
            ))}
          </nav>
        </aside>

        <article className="prose-lensy min-w-0 max-w-[760px] lg:col-span-8 lg:col-start-5" data-testid="cli-guide">
          <H2 id="what-it-is">What it is</H2>
          <p>
            <code>lensy</code> checks live documentation pages and gives each one two scores out of 100. Coding agents is how well a coding agent can find and read the page. AI search is how well AI search engines can retrieve and cite it. It runs the same checks as the website. The Coding agents score is built on AFDocs, the open Agent-Friendly Documentation checks, plus one Lensy check for headings.
          </p>
          <p>
            It checks exactly the pages you give it and doesn&apos;t crawl your site. It runs on your own machine or CI runner, so nothing about your pages is sent to Perseverance AI.
          </p>

          <H2 id="install">Install</H2>
          <p>You need Node 22 or newer.</p>
          <Block label="Install command">{`npm install -g @perseverance-ai/lensy@next
lensy --version`}</Block>
          <p>To run it once without installing:</p>
          <Block label="Run without installing">{`npx @perseverance-ai/lensy@next check https://docs.example.com/guide`}</Block>
          <p>The tool is an early release, so it is published under the <code>next</code> tag.</p>

          <H2 id="check-a-page">Check a page</H2>
          <Block label="Check one page">{`lensy check https://docs.example.com/guide`}</Block>
          <p>
            A bare hostname such as <code>docs.example.com</code> works too and gets <code>https://</code> added. For one page, the terminal shows both scores, whether an honest AI agent can reach the page, how much of the page an agent receives, and every check with its points, what it found and how to fix it. Checks that come from AFDocs are marked <code>AFDocs</code>. A page takes about 10 to 30 seconds.
          </p>
          <p>Example output, shortened:</p>
          <Block label="Example output for one page">{`https://vitest.dev/guide/
  Coding agents 87/100    AI search 68/100
  Reachability: an honest AI agent can read this page (HTTP 200). robots.txt allows all 6 AI search bots.
  What an agent receives: Markdown, 7,693 characters (about 1,923 tokens), fits in one fetch

  Coding agents  87/100
    PASS    llms-txt-exists         llms.txt exists AFDocs      10/10   llms.txt found at https://vitest.dev/llms.txt
    FAIL    content-negotiation     Markdown on request AFDocs  0/4     Server ignores Accept: text/markdown header
          Fix: Your server ignores Accept: text/markdown and returns HTML. ...`}</Block>
          <p>Colour is off when the output goes to a file or a pipe, when you pass <code>--no-color</code>, and when the <code>NO_COLOR</code> variable is set.</p>

          <H2 id="check-several-pages">Check several pages</H2>
          <p>Give more than one URL:</p>
          <Block label="Check several pages">{`lensy check https://docs.example.com/start https://docs.example.com/api`}</Block>
          <p>Or list them in a file, one URL per line. Blank lines and lines that start with <code>#</code> are ignored.</p>
          <Block label="A URL list file">{`# docs to check
https://docs.example.com/start
https://docs.example.com/api`}</Block>
          <Block label="Check the pages in a file">{`lensy check --urls-file urls.txt`}</Block>
          <p>
            With several pages, the terminal shows one row per page with both scores, then the three most useful fixes for each page. The full detail goes in a report file. A URL listed twice is checked once.
          </p>
          <Block label="Example summary for several pages">{`Page                               Coding agents  AI search  Status
https://vitest.dev/guide/cli       83/100         68/100     ok
https://vitest.dev/guide/features  87/100         71/100     ok
https://vitest.dev/guide/          87/100         68/100     ok`}</Block>
          <p>
            Pages are checked two at a time. <code>--concurrency</code> takes a number from 1 to 5. There is no page limit. Above 15 pages, the tool prints the page count and a rough time before it starts.
          </p>

          <H2 id="reports">Save a report</H2>
          <p>Add <code>--html</code> or <code>--md</code> to save the full result. Use both in one run if you like.</p>
          <Block label="Save reports">{`lensy check https://docs.example.com/guide --html report.html --md report.md`}</Block>
          <p>
            The HTML report is one file that opens offline: no scripts and no external links, with light and dark themes. The Markdown report is for coding agents. It starts with the scores and the tool version, then lists each fix as a checkbox, ordered by how many points it gains, so you can hand it to an agent as a to-do list. Both reports hold the same content in the same structure, called report version 1. The folder you name must already exist. If it doesn&apos;t, the command stops before it checks anything.
          </p>

          <H2 id="explain">Explain a check</H2>
          <Block label="Explain a check">{`lensy explain llms-txt-exists`}</Block>
          <p>
            This prints what the check measures, why it matters, how many points it is worth and the evidence behind it. Use any check id from a report. Ids are not case sensitive. They are the AFDocs names, such as <code>llms-txt-exists</code> and <code>rendering-strategy</code>, and <code>S1</code> to <code>S6</code> for AI search.
          </p>

          <H2 id="exit-codes">Exit codes</H2>
          <ul>
            <li><code>0</code>: every page was checked.</li>
            <li><code>2</code>: the command was wrong. There was no URL, an option had a bad value, or a URL was a local address. Nothing was fetched.</li>
            <li><code>3</code>: at least one page couldn&apos;t be checked. It was unreachable, it wasn&apos;t an HTML page, or its bot protection refused the tool. The other pages still print.</li>
            <li><code>1</code>: something unexpected failed. The message starts with <code>lensy:</code>.</li>
          </ul>
          <p>
            Scores never change the exit code, so a failing check doesn&apos;t fail a CI job. A page that couldn&apos;t be checked does. If a site&apos;s bot protection refuses the tool, it doesn&apos;t retry as a browser. It says the page wasn&apos;t checked and points you to the audit on perseveranceai.com.
          </p>

          <H2 id="what-it-sends">What it sends</H2>
          <p>
            Every request carries <code>lensy-cli/&lt;version&gt; (+https://perseveranceai.com/bot)</code>. The <Link to="/bot">bot page</Link> explains what Lensy fetches and how a site owner can allow it.
          </p>
          <p>
            For each page the tool fetches the page itself, robots.txt, the sitemap, llms.txt, a sample of the pages llms.txt links to, the Markdown version of the page, and a few other URLs that the AFDocs checks need. That is usually 15 to 60 requests per page. They go from your machine to the sites you named, and nowhere else.
          </p>
          <p>
            <code>--user-agent</code> sends a different name, for example to test a rule on your own site. <code>--timeout</code> sets how long each request may take, in milliseconds, from 1000 to 120000.
          </p>

          <H2 id="not-yet">What it can&apos;t do yet</H2>
          <ul>
            <li>Check a local build. <code>localhost</code> and other local addresses are refused with exit code 2. Checking a build folder on your machine is planned.</li>
            <li>Check source files before you build.</li>
            <li>Check pages behind a login. The tool can&apos;t sign in, so it only checks public pages.</li>
          </ul>
          <p>
            Questions, or something here is wrong? Write to <a href="mailto:hello@perseveranceai.com">hello@perseveranceai.com</a>.
          </p>
        </article>
      </div>
    </Page>
  );
}
