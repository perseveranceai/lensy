# Requirements: Lensy CLI, phase 1 (local use)

## Introduction

`lensy` is the command-line version of Lensy. It checks whether AI search engines and coding agents can find and read a docs page, and reports two scores out of 100: **Coding agents** and **AI search**. It runs the same engine code as perseveranceai.com, from the same repository, so a page gets the same points in both.

**Phase 1 (this spec):** users run it on their own machine, before opening a PR, against any of three targets:
- a live URL;
- a local build of the docs site;
- the `.md` or `.mdx` source files, before building.

**First release:** a 0.x version for the design partner (early access), so they can try it on their own docs before a public announcement.

**Phase 2 (later):** automation in users' CI pipelines, covering thresholds, baselines, a config file, JSON output and a GitHub Action. Phase 2 is recorded in design.md, "Phase 2", and isn't required here.

The CLI lives in the `perseveranceai/lensy` repo, under `packages/`. The scoring engine stays where the website uses it (`backend/lambda/agent-handler/`) and is not copied. Features added to the engine for the website reach the CLI without a separate port (Requirement 6). New code is written only where nothing existing does the job (Req 6.8).

Glossary:
- **Engine:** the pure, network-only scoring code shared by the website and the CLI. The file list is in design.md "Engine".
- **Check:** one scored rule, such as C1 or S3. Defined in `docs/two-score-readiness/spec.md` §4 and listed in the engine's check registry.
- **Check registry:** the engine's list of every check with its id, label, points, score, source and explanation (design.md "Check registry").
- **Local mode:** checking a site served from this machine (`--serve`, or a `localhost` URL), where hosting behaviour can't be measured.
- **Source mode:** checking `.md` or `.mdx` source files directly, before a build (Requirement 8).
- **Host-dependent check:** a check whose result comes, fully or partly, from the web server or CDN rather than the docs build.
- **Report model:** the website's pure functions that turn engine results into what the report shows: grouped checks, the ordered list of fixes, the reachability banner and the agent preview line (`frontend/src/report/reportModel.ts`).
- **Usage record:** a short, opt-in record of one CLI run, sent to Perseverance AI (Requirement 4).
- **Parity:** the CLI gives the same per-check points as the website for the same server responses. The website retries with a browser user agent when it's refused and the CLI doesn't (Req 1.5), so parity covers responses to the honest user agent.
- **Our PR checks:** the automated tests this repo runs on its own pull requests (`.github/workflows/`). These are separate from phase 2, which runs Lensy in users' pipelines.

## Requirement 1: Check a live page

**User story:** As a technical writer, I want to check a published docs page from my terminal, so that I get the same result as the Lensy website without visiting it.

1. WHEN the user runs `lensy check <url>` THE SYSTEM SHALL fetch the page and the resources the engine needs (robots.txt, sitemap, llms.txt, the Markdown version), and print both scores and every check with its points, its finding and, where it falls short, its fix.
2. THE SYSTEM SHALL produce the same per-check points, details and fixes as the website for the same server responses (parity). The parity tests in design.md "Testing" enforce this.
3. WHEN more than one URL is given, or `--urls-file <path>` is used, THE SYSTEM SHALL check each page and print a summary table followed by each page's details.
4. THE SYSTEM SHALL fetch as `Lensy-CLI/<version> (+https://perseveranceai.com/bot)`, and SHALL let the user override this with `--user-agent`.
5. THE SYSTEM SHALL NOT retry with a browser user agent. Every request uses the honest user agent only.
6. IF a request fails at the network level (DNS, TLS, timeout, connection reset) after the engine's retries THEN THE SYSTEM SHALL report the checks that depend on it as "unknown (network error)" with no points, never as missing, and SHALL mark the score as partial.
7. IF the page is refused with 403 or 429 THEN THE SYSTEM SHALL stop for that page, say the site's bot protection blocked the check, and suggest running the audit on https://perseveranceai.com instead. It SHALL NOT suggest weakening bot protection.
8. IF the page itself can't be fetched, or isn't HTML, THEN THE SYSTEM SHALL say so for that page and give it no scores.
9. THE SYSTEM SHALL exit with code 0 when every page was checked, 2 for invalid usage, and 3 when any page couldn't be checked (blocked, unreachable, not HTML).

## Requirement 2: Check a local build before pushing

**User story:** As a technical writer, I want to check my docs build on my own machine, so that I catch problems before I open a PR.

**Build or source:** agents and crawlers see the built site: the HTML pages plus any generated `.md` copies, `llms.txt`, sitemap and `robots.txt`. Checking the build (this requirement) gives the full result. Checking the source (Requirement 8) is faster and needs no build, but it can only measure what's in the Markdown itself.

1. WHEN the user runs `lensy check --serve <dir> [path...]` THE SYSTEM SHALL serve that directory on a free local port and check the given paths. With no paths, it SHALL check `/`.
2. WHEN the URL host is `localhost`, `127.0.0.1` or `[::1]`, or `--serve` is used, THE SYSTEM SHALL run in local mode.
3. WHILE in local mode THE SYSTEM SHALL mark checks the registry lists as fully host-dependent as "skipped (depends on your hosting)", give them no points, and compute each score over the checks that apply. It SHALL label those scores "local".
4. WHILE in local mode THE SYSTEM SHALL score checks the registry lists as partly host-dependent, and SHALL say which part the local server can't show.
5. WHEN `--site-url <url>` is given THE SYSTEM SHALL check each page as if it were published at that site, sending every request for that site to the local server with the same path. Links to the site in llms.txt, the sitemap and canonical tags then resolve against the local build.
6. WHILE in local mode THE SYSTEM SHALL send no requests off the machine, apart from the opt-in usage record (Req 4.7). Requests to any other host SHALL fail as network errors (Req 1.6).
7. IF the `--serve` directory contains no `.html` files but does contain `.md` or `.mdx` files THEN THE SYSTEM SHALL check them in source mode (Requirement 8) and say so, rather than stopping. IF it contains neither THEN THE SYSTEM SHALL exit with code 2 and name the usual build command and output folder for VitePress, Docusaurus and Mintlify.
8. WHEN the user checks a `localhost` URL rather than a `--serve` directory THE SYSTEM SHALL say that a development server can render pages differently from the production build, and that `--serve` on the build output gives the closest result.

## Requirement 3: Output for people and coding agents

**User story:** As a writer, I want a report I can read and share, and my coding agent wants one it can act on, so that the fixes get done.

**Agreed output (phase 1):**
- **Terminal text,** for quick reading. Its layout may change between releases.
- **An HTML report,** for people to read and share.
- **A Markdown report,** for coding agents.

The HTML and Markdown reports are the **stable contract**. They share one versioned structure (criteria 4–6), built from the same report model as the website, so a page looks the same in the CLI's reports and on the website. JSON output moves to phase 2 (Requirement 5), where CI needs it.

1. THE SYSTEM SHALL print readable text by default: colour when the output is a terminal, plain otherwise, and none with `--no-color` or `NO_COLOR`. The text layout is not a stable format.
2. WHEN `--html <file>` is given THE SYSTEM SHALL write one HTML report for the run. The report SHALL be a single self-contained file: inline CSS, no JavaScript, and no external requests (fonts, images or scripts), so it opens offline and can be attached to an email or a ticket. It SHALL use the website's colours and type scale, follow the reader's light or dark setting, and print cleanly.
3. WHEN `--md <file>` is given THE SYSTEM SHALL write one Markdown report for the run, so that a coding agent can work through it.
4. BOTH reports SHALL start with the same metadata: `reportVersion: 1`, `tool`, `toolVersion`, `engineCommit`, `checkedAt`, the mode (`url`, `local` or `source`), and, for each page, `url` (or source file path relative to the checked folder), `status`, `codingAgents` and `aiSearch` (the scores, or `null`). The Markdown report holds them as YAML front matter; the HTML report holds them in a header block and in `<meta>` tags.
5. BOTH reports SHALL contain these sections, in this order, for each page. The grouping, wording and order come from the website's report model, so they match the website:
   - **Summary:** both scores, with "local", "source" or "partial" when they apply; the reachability banner; and the agent preview line.
   - **Both audiences:** the checks that feed both scores (content without JavaScript, sections), as on the website.
   - **Coding agents:** the remaining coding-agent checks, with `ID`, `Check`, `Status`, `Points`, `Max` and `Finding`.
   - **AI search:** the remaining AI-search checks, with the same columns.
   - **Fixes:** each fix listed once, with its check ID and the points it would gain, ordered by points to gain. The Markdown report uses `- [ ]` items.
   - **Tips.**
   - **Skipped and unknown checks:** only when there are any, with the reason for each.
6. THE SYSTEM SHALL keep both reports backwards-compatible within `reportVersion: 1`. New metadata fields, columns and sections may be added at the end. Removing, renaming or reordering any of them SHALL require `reportVersion: 2`. A change to the website's report SHALL NOT change the CLI reports' structure without following this rule.
7. THE SYSTEM SHALL use the engine's findings and fix text unchanged, including its platform-specific fixes for VitePress, Docusaurus and Mintlify.
8. WHEN the user runs `lensy explain <checkId>` THE SYSTEM SHALL print what the check measures, its points, why it matters and its evidence links, from the check registry.

## Requirement 4: Trust, usage records and support

**User story:** As an engineer at a company, I want to know exactly what the tool does and sends, so that I'm allowed to install it. As the Lensy team, we want to know who uses the CLI, on which pages, and whether runs succeed, so that we can support users and improve it.

**Approach:** usage records are **opt-in**. Nothing is sent until the user says yes, and what is sent is fixed, short and documented. Records go to the same DynamoDB audit log the website writes for every scan (`AuditLogTable`), using the same attribute names, so CLI and website usage can be read side by side. The table's key schema needs no change:
- the partition key is `sessionId`, and the CLI uses a unique `cli-` prefixed id per page;
- the `AuditUrlIndex` index keeps working because each record carries `auditUrl` and `submittedAt`;
- every other attribute is schemaless.

One backend change is unavoidable. The API handler can't write to that table today, and no existing endpoint accepts usage records. So the backend needs a new, validated endpoint (criterion 9). The existing feedback endpoint (`POST /console/feedback`) stays for support reports only, because it emails the team on every call.

1. THE SYSTEM SHALL send nothing to Perseverance AI unless the user has opted in to usage records, or runs `lensy report-issue` (criteria 12–14). Apart from those, it SHALL make no requests other than those needed to check the given pages.
2. WHEN the CLI runs for the first time in an interactive terminal THE SYSTEM SHALL ask once whether to share usage records. The prompt shows exactly what a record contains, and the default is No. WHEN stdin or stdout isn't a terminal, or the `CI` environment variable is set, THE SYSTEM SHALL NOT ask and SHALL NOT send.
3. THE SYSTEM SHALL let the user change the choice at any time with `lensy usage on`, `lensy usage off` and `lensy usage status`, and override it for one run with `--no-usage` or `LENSY_USAGE=0`. It SHALL store the choice in `~/.lensy/config.json`.
4. WHEN usage records are on THE SYSTEM SHALL send one record per page checked, after the page is checked, containing only:
   - **Who:** `trafficSource: "cli"`, `cliVersion`, `engineCommit`, operating system family, Node major version, and a random install id created at opt-in. The install id is not linked to any personal data and is deleted by `lensy usage off`.
   - **What:** the mode (`url`, `local` or `source`), and the page:
     - for a live URL, `submittedUrl`, `finalUrl` and `auditUrl`;
     - for local or source mode, the `--site-url` page URL if given, otherwise only the path relative to the checked folder (for example `/guide/start` or `guide/start.md`), never the absolute path on the user's machine.
   - **Result:** `status` (`completed`, `rejected` or `failed`), a `reason` when it isn't `completed` (`blocked-by-bot-protection`, `unreachable-url` and the new `not-html`, `no-source-files` and `internal-error`), `httpStatus`, `codingScore` and `searchScore` (or none), `scoringVersion`, `analysisTimeMs`, and the IDs of checks that failed, were skipped or were unknown. The check IDs show why a run scored as it did.
   - **When:** `submittedAt`, set by the server.
5. THE SYSTEM SHALL NOT include in a usage record: page content, file contents, absolute file paths, environment variables, command-line flag values, the `--user-agent` value, the user's IP address, or error stack traces.
6. THE SYSTEM SHALL send usage records over HTTPS to `https://api.perseveranceai.com`, with a timeout of 2 seconds. For testing, the `LENSY_API_URL` environment variable may point it elsewhere. The published package SHALL NOT contain gamma or other environment hostnames. Failures SHALL be silent, except with `LENSY_DEBUG=1`. Sending SHALL never delay the result or change the exit code.
7. THE SYSTEM SHALL list every usage-record field in the README and in `lensy usage status`.
8. THE SYSTEM SHALL keep usage records under the existing policy for website scan records: no automatic expiry, deleted on request to hello@perseveranceai.com. THE perseveranceai.com privacy page SHALL describe usage records (what they contain, that they are opt-in, and how long they're kept) in the same release that ships them. `AGENTS.md` SHALL add `cli` to the audit log's `trafficSource` values, and traction reporting SHALL count `cli` as its own line next to `web`.
9. THE backend SHALL accept usage records only through a new endpoint (for example `POST /cli/usage`) that:
   - accepts only the fields in criterion 4, with type and length limits;
   - rejects anything else with HTTP 400;
   - computes the hashed IP itself, with the existing `hashIp`;
   - accepts at most 500 records per hashed IP per day (configurable), returning HTTP 429 above that;
   - writes to `AuditLogTable` with least-privilege, write-only access.

   It SHALL NOT send email.
10. `packages/`, the six engine files and the published packages SHALL be licensed MIT. Each published package SHALL include the LICENSE file and a THIRD_PARTY_LICENSES file for bundled dependencies. `packages/` SHALL contain SECURITY.md, naming hello@perseveranceai.com as the security contact, and CONTRIBUTING.md. Nothing else in the repo is licensed by this requirement.
11. THE SYSTEM SHALL document every check: what it measures, its points and why it matters, with links to the evidence. THE published packages SHALL contain no AWS account IDs, internal hostnames, secrets or customer names, and our PR checks SHALL fail on a secrets-scan finding in `packages/` or in the published bundle. THE SYSTEM SHALL be published to npm as `@perseverance-ai/lensy` (CLI) and `@perseverance-ai/lensy-core` (engine API), and SHALL stay at 0.x until the afdocs integration (Requirement 7) lands. The first early-access version MAY be published by hand. Later releases SHALL be published by a GitHub Actions workflow with npm trusted publishing and provenance, after Rakesh's approval. THE perseveranceai.com/bot page SHALL describe the CLI's user agent alongside the website's, and say that the CLI runs from the user's own machine.
12. WHEN the user runs `lensy report-issue [--last] [--message <text>] [--email <address>]` THE SYSTEM SHALL build a support report and print it in full before sending. The report contains:
    - the CLI version, engine commit, Node version and operating system;
    - the command-line flags, with values removed;
    - for each checked page (with `--last`): the same fields as a usage record;
    - the user's message, and their email address only if they give one.

    It SHALL send the report to the existing feedback endpoint only after the user confirms (`y` at the prompt, or `--yes`). This works whether or not usage records are on.
13. IF sending a support report fails, or the user declines, THEN THE SYSTEM SHALL write the same report to a local file and print its path and hello@perseveranceai.com, so the user can send it by email instead.
14. THE SYSTEM SHALL keep `--last` details only in a local file, `~/.lensy/last-run.json`, overwritten on each run and never sent except by criterion 12.

## Requirement 5: (reserved for phase 2: automation)

Thresholds (`--fail-under`), baselines, exit code 1, `lensy.config.json`, the GitHub Action, and `--json` output (versioned like the reports in Req 3.6). See design.md, "Phase 2".

## Requirement 6: Website features reach the CLI

**User story:** As the Lensy team, I want every scoring change we make for the website to reach the CLI without a separate port, so that the two never disagree.

1. THE engine SHALL be the only place that computes scores, check points, findings, fixes, gate state, tips and the agent preview. Website-only code SHALL NOT compute a scored result.
2. THE engine SHALL import nothing from AWS SDKs, LangChain, S3 or progress helpers, React, or `process.env`. Our PR checks SHALL fail when it does.
3. WHEN the engine returns a check THE SYSTEM SHALL render it in text, HTML and Markdown output without a CLI code change, using the check registry for its label and explanation.
4. Our PR checks SHALL fail if a check the engine can return has no registry entry, or a registry entry has no explanation or evidence.
5. Our PR checks SHALL fail if a field the engine adds to its report output is neither in the CLI's report nor on an explicit "website only" list.
6. THE CLI's build and tests SHALL run on every PR that changes engine files or the report model, as well as on PRs that change `packages/`.
7. WHEN a PR changes the website's Markdown download renderer (`frontend/src/report/markdown.ts`) without changing the CLI's, our PR checks SHALL post an advisory warning. They SHALL NOT fail the build.
8. THE CLI SHALL reuse existing code rather than rebuild it. In particular:
   - **Scoring, in every mode, including source mode:** the engine's `scoreCodingAgents`, `scoreAiSearch`, `gateState` and `tipsV2`.
   - **Markdown and HTML measurement:** the engine's helpers `headingsFromMd`, `headingsFromHtml`, `headingSkips`, `sectionWords`, `wordCount`, `textOf` and `looksMarkdown`.
   - **robots.txt rules and URL matching:** `robotsAllows` and `normUrl`.
   - **Report grouping, fix order, reachability banner and agent preview line:** the website's report model functions (`readScoringV2`, `gateBannerText`, `previewSummary`, and the grouping and fix-ordering functions). These SHALL be moved into a shared pure file, imported by both the website and the CLI, rather than copied.

   New code SHALL go in the engine when it measures or scores something (for example reading front matter or stripping MDX), so the website can use it later. A PR that adds a function duplicating an engine or report-model function SHALL say why in its description.

## Requirement 7: Ready for checks from other sources

**User story:** As the Lensy team, I want to add checks from other sources, such as afdocs, later without breaking CLI users.

1. THE report format SHALL allow check ids beyond C1–C6 and S1–S6, and SHALL record each check's `source` (`lensy` now; others later).
2. THE report format SHALL allow a score to carry optional category sub-scores.
3. THE report format SHALL record the report's `scope` (`page` in phase 1).
4. Readers of `reportVersion: 1` (Req 3.6) SHALL be able to ignore fields, rows and sections they don't know. Adding a check, source, category or field SHALL NOT need a new report version. Removing or renaming one SHALL.

## Requirement 8: Check source files while writing

**User story:** As a technical writer, I want to check my `.md` and `.mdx` files as I write them, so that I find problems without building the site.

**How this differs from the other targets:**

| | Live page (Req 1) | Built site (Req 2) | Source files (this requirement) |
|---|---|---|---|
| What's checked | The published HTML page and the files the site serves | The build output: HTML plus generated `.md` copies, `llms.txt`, sitemap and `robots.txt` | The `.md` / `.mdx` files the writer edits |
| Build needed | No (already published) | Yes | No |
| Command | `lensy check <url>` | `lensy check --serve <dist>` | `lensy check --source <docs>` |
| Checks scored | All 12 | 11 of 12 (C2 depends on the host) | About 4–6 of 12 (table below) |
| Best for | The real, published result | The closest result before publishing | Fast feedback while writing |

**What source mode can and can't measure:** some checks depend only on what's written in the Markdown. Others depend on what the build or the host adds, such as rendered HTML, generated `llms.txt`, the sitemap, canonical tags and JSON-LD. Source mode scores the first group, marks the second as "needs the built site", and never guesses at them.

| Check | In source mode |
|---|---|
| C5 Page fits one fetch | Scored, from the Markdown length (an estimate of what an agent receives) |
| C6 Sections findable | Partly scored: H1 count and heading levels (11 of 15 points). Heading ids need the build. |
| S5 Answer-ready sections | Scored: H1 count, heading levels and section length. The build may add an H1 from the front-matter `title`, and the result says so. |
| S4 Freshness declared | Partly scored: a page date from front matter (`lastUpdated`, `last_update`, `date`) (6 of 15 points). Sitemap dates need the build. |
| C4 llms.txt usable | Scored only when a static `llms.txt` is in the folder (for example `public/` or `static/`). Links are checked against files in the folder. |
| S1 AI search bots allowed | Scored only when a static `robots.txt` is in the folder |
| C1, S2 (content without JavaScript), C2, C3, S3, S6 | Skipped: needs the built site |

1. WHEN the user runs `lensy check --source <file-or-dir>` THE SYSTEM SHALL check each `.md` and `.mdx` file, skipping `node_modules`, hidden folders and files ignored by the folder's `.gitignore`, and print a summary table followed by each file's details.
2. THE SYSTEM SHALL read the files from disk only, and SHALL make no network requests in source mode, apart from the opt-in usage record (Req 4.4).
3. BEFORE measuring a file THE SYSTEM SHALL:
   - remove YAML front matter, keeping its `title` and date fields;
   - remove MDX `import` and `export` lines, JSX expressions and component tags, keeping the text inside components;
   - treat `{#custom-id}` heading suffixes as ids, not heading text;
   - treat both ``` and ~~~ code fences as code.
4. THE SYSTEM SHALL score source files by building engine signals from the cleaned Markdown and calling the engine's scoring functions (Req 6.8), not with separate scoring rules. Checks that source mode can't measure SHALL be marked "skipped (needs the built site)" with no points, never scored as failing.
5. THE SYSTEM SHALL compute each source-mode score over the checks and parts that apply, label it "source", and say how many of that score's 100 points it covers. For example, without static `llms.txt` or `robots.txt` files: "Coding agents 85 (source, covers 26 of 100 points)" and "AI search 70 (source, covers 21 of 100 points)".
6. THE SYSTEM SHALL detect the docs platform from its config file (`.vitepress/config.*`, `docusaurus.config.*`, `mint.json` or `docs.json`) and use the engine's platform-specific fixes.
7. THE SYSTEM SHALL end each source-mode result with one line saying how to check the full result: build the site and run `lensy check --serve <output folder>`, with the build command and output folder for the detected platform.
8. IF a `.mdx` file uses components that render content at build time (for example tabs or imported snippets) THEN THE SYSTEM SHALL say that the length and section results are estimates for that file.
9. IF the given path contains no `.md` or `.mdx` files THEN THE SYSTEM SHALL exit with code 2 and say so.
