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
  ["local-build", "Check a local build"],
  ["reports", "Save a report"],
  ["save-and-compare", "Save and compare runs"],
  ["explain", "Explain a check"],
  ["exit-codes", "Exit codes"],
  ["what-it-sends", "What it sends"],
  ["not-yet", "What it can't do yet"],
  ["help", "Requirements and help"],
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
          <p>The tool is an early release, published under the <code>next</code> tag. For now it&apos;s also what <code>npm install -g @perseverance-ai/lensy</code> installs.</p>

          <H2 id="check-a-page">Check a page</H2>
          <Block label="Check one page">{`lensy check https://docs.example.com/guide`}</Block>
          <p>
            A bare hostname such as <code>docs.example.com</code> works too and gets <code>https://</code> added. For one page, the terminal shows both scores, whether an honest AI agent can reach the page and how much of the page an agent receives. Then it lists what to fix first, ordered by the points each fix is worth, with one line on what to do. The points add up to each score: fix everything listed and both scores reach 100. A page takes a few seconds, or up to half a minute on a large site.
          </p>
          <p>Example output, shortened:</p>
          <Block label="Example output for one page">{`https://vitepress.dev/guide/getting-started
  Coding agents 87/100    AI search 95/100
  Reachability: an honest AI agent can read this page (HTTP 200). robots.txt allows all 6 AI search bots.
  What an agent receives: Markdown, 6,235 characters (about 1,559 tokens), fits in one fetch

  Fix these first
   1. Page points agents to llms.txt (HTML)       −6  Coding agents
      Add a visually-hidden element near the top of each page containing a link to your llms.txt.
   2. JSON-LD                                     −5  AI search
      Add a JSON-LD block (for example TechArticle) with dateModified.
   3. Page points agents to llms.txt (Markdown)   −4  Coding agents
   4. Markdown on request                         −3  Coding agents

  Passed: 20 of 25 Coding agents checks, 5 of 6 AI search checks.`}</Block>
          <p>
            Add <code>--verbose</code> to see every check instead: its id, its points, what it found and the full fix. Checks that come from AFDocs are marked <code>AFDocs</code>. AFDocs checks add up to more than 100 points, so the score scales them to 100, and the verbose view says so.
          </p>
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

          <H2 id="local-build">Check a local build</H2>
          <p>
            Check your docs before you publish them: build the site, then point Lensy at the build folder. Lensy serves the folder on your machine for the length of the run and checks it like a published site. Nothing is sent anywhere else.
          </p>
          <Block label="Check a VitePress build">{`npx vitepress build docs
lensy check --dir docs/.vitepress/dist --site-url https://docs.example.com --all`}</Block>
          <p>
            <code>--site-url</code> is your published docs address. Your build&apos;s sitemap, <code>llms.txt</code> and canonical links name that address, and Lensy matches them to the local files, so the result is what the published site will get. <code>--all</code> checks every page in the build. Without it, name pages by their path, such as <code>/guide/getting-started</code>, or leave them out to check the home page.
          </p>
          <p>
            The build folder depends on your docs tool: <code>docs/.vitepress/dist</code> for VitePress, <code>build</code> for Docusaurus, <code>site</code> for MkDocs and <code>dist</code> for Astro Starlight. If your docs live under a path, such as VitePress <code>base: &apos;/docs/&apos;</code>, include it in <code>--site-url</code>: <code>https://example.com/docs</code>.
          </p>
          <p>Some checks depend on your web server or CDN, not your build, so a local check leaves them out and says so. Each score shows the points earned out of the points it could check:</p>
          <Block label="Example local check">{`https://docs.example.com/guide/getting-started
  Coding agents 58 of 70 points checked    AI search 77 of 100 points checked

  Fix these first
   1. Freshness declared                         −15  AI search
      Set lastUpdated: true in the VitePress config.
   2. Page points agents to llms.txt (HTML)       −6  Coding agents

  Not checked here (your web server or CDN decides these, so check the live site for them): Markdown
  on request, Real 404s for missing pages, Redirects, Cache headers, Public without login, Bot
  protection lets agents in.`}</Block>
          <p>Fix something, rebuild and check again. With saving on, you see the change straight away:</p>
          <Block label="Example local comparison">{`  Since today: Coding agents 58 → 58    AI search 77 → 89 (+12)`}</Block>
          <p>
            Already running your docs tool&apos;s preview of the production build? Point Lensy at it instead: <code>lensy check http://localhost:4173 --site-url https://docs.example.com --all</code>, where <code>--all</code> reads the preview&apos;s sitemap. Use the preview command (<code>vitepress preview</code>, <code>docusaurus serve</code>), not the dev server, which can render pages differently.
          </p>

          <H2 id="reports">Save a report</H2>
          <p>Add <code>--html</code>, <code>--md</code> or <code>--json</code> to save the full result. Use any of them together in one run.</p>
          <Block label="Save reports">{`lensy check https://docs.example.com/guide --html report.html --md report.md --json report.json`}</Block>
          <p>
            The HTML report is one file that opens offline: no scripts and no external links, with light and dark themes. The Markdown report is for coding agents. It starts with the scores and the tool version, then the checks in tables, then each fix as a checkbox, ordered by how many points it gains, so you can hand it to an agent as a to-do list. Both reports hold the same content in the same structure, called report version 1. The JSON file is for scripts and CI: each page has its scores, its fixes ordered by points lost, and the full check results. Use <code>--json -</code> to print only the JSON, for example to pipe it to <code>jq</code>. The folder you name must already exist. If it doesn&apos;t, the command stops before it checks anything.
          </p>

          <H2 id="save-and-compare">Save and compare runs</H2>
          <p>
            Lensy can keep every run and compare each page with its last run, so you can see whether your docs got better or worse, what you fixed and what broke. The first time you run <code>lensy check</code> in a project, it asks:
          </p>
          <Block label="The first-run question">{`Save Lensy results for this project in .lensy? Each run is compared with the last one, so you can see what changed. [Y/n]`}</Block>
          <p>
            Answer <code>y</code> and Lensy creates a <code>.lensy</code> folder at the root of your project (the folder with <code>.git</code>, or the current folder outside a git project) and remembers the answer there. Answer <code>n</code> and nothing is created; Lensy remembers that in <code>~/.lensy/config.json</code> and doesn&apos;t ask again. It only asks in a terminal. In CI, in a script, or with <code>--json -</code>, it never asks, and saves only when told to.
          </p>
          <p>From the next run on, each page shows what changed since its last saved run:</p>
          <Block label="Example comparison">{`https://vitepress.dev/guide/getting-started
  Coding agents 87/100    AI search 95/100
  Since Nov 2 (6 days ago): Coding agents 80 → 87 (+7)    AI search 95 → 95
  Fixed: llms.txt exists`}</Block>
          <p>
            <code>New:</code> lists checks that passed last time and lose points now. With several pages, the summary table gets a <code>Change</code> column, such as <code>+7 / 0</code> or <code>first run</code>.
          </p>
          <p>The folder holds JSON for scripts and Markdown for people and coding agents:</p>
          <Block label="The .lensy folder">{`.lensy/
├── config.json      project settings
├── latest.md        the last run, every page: hand it to a coding agent
├── history.md       one row per page per run, newest first
└── pages/
    └── docs.example.com/guide/start/
        ├── page.json        which URL this folder is for
        ├── latest.json      the newest result for this page
        ├── latest.md        the report for this page
        └── runs/2026-11-08T183012Z.json   one file per run`}</Block>
          <p>
            Lensy keeps the newest 52 runs of each page. List the pages you check in <code>.lensy/config.json</code>, and <code>lensy check</code> with no URLs checks them all. Keep <code>&quot;save&quot;: true</code> in that file so runs without a terminal, such as in CI, save too; if <code>.lensy</code> exists but a run doesn&apos;t save, Lensy says so.
          </p>
          <Block label="Project settings">{`{
  "configVersion": 1,
  "save": true,
  "keep": 52,
  "pages": ["https://docs.example.com/guide/start", "https://docs.example.com/api"]
}`}</Block>
          <p>
            For one run, <code>--save</code> saves even if you answered no, <code>--no-save</code> skips saving and the question, and <code>--save-dir</code> saves in another folder. Saved results stay on your machine. Commit <code>.lensy</code> to share the history with your team.
          </p>

          <H2 id="explain">Explain a check</H2>
          <Block label="Explain a check">{`lensy explain llms-txt-exists`}</Block>
          <p>
            This prints what the check measures, why it matters, how many points it is worth and the evidence behind it. Use any check id from a report or from <code>--verbose</code>. Ids are not case sensitive. They are the AFDocs names, such as <code>llms-txt-exists</code> and <code>rendering-strategy</code>, <code>lensy-headings</code> for Lensy&apos;s heading check, and <code>S1</code> to <code>S6</code> for AI search. <code>C1</code> to <code>C6</code> are the Coding agents checks Lensy uses only when AFDocs can&apos;t run.
          </p>

          <H2 id="exit-codes">Exit codes</H2>
          <ul>
            <li><code>0</code>: every page was checked.</li>
            <li><code>2</code>: the command was wrong. There was no URL, an option had a bad value, a <code>--dir</code> folder had no built pages, <code>.lensy/config.json</code> had a problem, or results couldn&apos;t be saved where asked. Nothing was fetched.</li>
            <li><code>3</code>: at least one page couldn&apos;t be checked. It was unreachable, it wasn&apos;t an HTML page, or its bot protection refused the tool. The other pages still print.</li>
            <li><code>1</code>: something unexpected failed, or the results of a run that was told to save couldn&apos;t be written. The message starts with <code>lensy:</code> or <code>Couldn&apos;t save results</code>.</li>
          </ul>
          <p>
            Scores never change the exit code, so a failing check doesn&apos;t fail a CI job. A page that couldn&apos;t be checked does. If a site&apos;s bot protection refuses the tool, it doesn&apos;t retry as a browser. It says the page wasn&apos;t checked and points you to the audit on perseveranceai.com.
          </p>

          <H2 id="what-it-sends">What it sends</H2>
          <p>
            Every request carries <code>lensy-cli/&lt;version&gt; (+https://perseveranceai.com/bot)</code>. The <Link to="/bot">bot page</Link> explains what Lensy fetches and how a site owner can allow it.
          </p>
          <p>
            For each page the tool fetches the page itself, robots.txt, the sitemap, llms.txt, a sample of the pages llms.txt links to, the Markdown version of the page, and a few other URLs that the AFDocs checks need. That is usually 15 to 60 requests per page. They go from your machine to the sites you named, and nowhere else. Saved results are written only to your own disk.
          </p>
          <p>
            <code>--user-agent</code> sends a different name, for example to test a rule on your own site. <code>--timeout</code> sets how long each request may take, in milliseconds, from 1000 to 120000.
          </p>

          <H2 id="not-yet">What it can&apos;t do yet</H2>
          <ul>
            <li>Check source files before you build.</li>
            <li>Check pages behind a login. The tool can&apos;t sign in, so it only checks public pages.</li>
          </ul>
          <H2 id="help">Requirements and help</H2>
          <p>
            You need Node 22 or newer and npm. There&apos;s no account, API key or setup. For live pages, Lensy needs network access to the sites you check and nothing else. A local build check sends nothing off your machine.
          </p>
          <p>
            <strong>Tested on.</strong> Every pull request runs the full test suite on Linux, macOS and Windows with Node 22 and 24. By hand, on macOS with Node 22, 24 and 26, we checked live pages on VitePress, Docusaurus, Mintlify, GitBook, Read the Docs, MkDocs Material, Nextra, Starlight and others, and local builds from VitePress 1.6 (with and without a base path), Docusaurus 3.10, Astro Starlight 0.42 and MkDocs Material 9.8. Windows and Linux desktops are covered by the automated tests, not yet by hand.
          </p>
          <p>
            <strong>Known issues being fixed:</strong> Astro&apos;s <code>sitemap-index.xml</code> and sitemaps under a base path aren&apos;t read yet, and a canonical link written without quotes, as Docusaurus minifies it, isn&apos;t detected. Each costs some AI search points it shouldn&apos;t.
          </p>
          <p>
            <strong>Found a problem?</strong> <a href="https://github.com/perseveranceai/lensy/issues/new?template=cli-bug.yml">Open an issue on GitHub</a>. The form asks for <code>lensy --version</code>, <code>node -v</code>, your operating system, the command and its output; add <code>LENSY_DEBUG=1</code> if it failed with an error. No GitHub account? Email <a href="mailto:hello@perseveranceai.com">hello@perseveranceai.com</a> with the same details. Report security problems by email, not as a public issue, and never paste tokens, internal hostnames or unpublished content.
          </p>
        </article>
      </div>
    </Page>
  );
}
