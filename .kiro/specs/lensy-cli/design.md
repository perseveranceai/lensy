# Design: Lensy CLI, phase 1 (local use)

## Overview

**Phase 1 (decided 2026-11-01):** the CLI runs on the user's own machine against a live URL, a local build (`--serve`) or `.md`/`.mdx` source files (`--source`). It writes terminal text, an HTML report and a Markdown report. The first release is a 0.x early-access version for the design partner. Automation in users' CI pipelines is phase 2 (see the end of this document).

The CLI lives in this repo (`perseveranceai/lensy`) under `packages/`, as a self-contained npm workspace. It reuses the website's code in place and copies nothing:
- **the engine** (`backend/lambda/agent-handler/`), which scores pages;
- **the report view** (`frontend/src/report/report-view.ts`, new, extracted from `reportModel.ts`), which groups checks, orders fixes and writes the banner and preview lines.

```
lensy check ──► flags ──► target
                            ├─ URL ───────────────► check(url)
                            ├─ --serve <dir> ─────► static server ─► check(localhost URL, local mode)
                            └─ --source <dir> ────► checkSource(files)
                                                         │
          engine (in place): fetchPage · collectSignalsV2 · source signals · scoring · buildScoringV2 · CHECKS
                                                         ▼
                                     Report { reportVersion: 1, scores, checks, gate, tips, ... }
                                                         │
                           report view (in place): groups · fixes · banner · preview line
                                                         │
                         ┌──────────────┬───────────────┼───────────────┐
                    terminal text   --html file     --md file     opt-in usage record ─► api.perseveranceai.com
```

Two packages, both published under the `perseverance-ai` npm organisation:
1. **`@perseverance-ai/lensy-core`** (`packages/core`): `check()`, `checkFromPage()`, `checkSource()`, the `Report` shape and local mode. It has no runtime dependencies.
2. **`@perseverance-ai/lensy`** (`packages/cli`): the `lensy` command. It handles flags, the static server, the three renderers, usage records and `report-issue`.

Three changes are on the website side:
- **API:** a custom domain (`api.perseveranceai.com`) and a new `POST /cli/usage` route.
- **Frontend:** the report-view extraction.
- **Copy:** updates to the `/bot` and privacy pages.

## Why same repo, and what that means

These decisions were made on 2026-11-01:
- The repo is already public, so a separate repo hides nothing.
- One copy of the engine and report view keeps the CLI and the website in step automatically.
- If outside contributors become a priority, `git subtree split --prefix=packages` gives `packages/` its own history.

Rules that follow:
- **`packages/` is self-contained.** It has its own `package.json` (workspace root, `private: true`), lockfile and `tsconfig.base.json`. The repo root, `backend/` and `frontend/` build scripts don't change.
- **`packages/` imports only allowlisted website files:** the engine files and `frontend/src/report/report-view.ts`. The boundary test enforces this.
- **Website edits are backwards-compatible.** Existing backend Jest and frontend e2e suites must pass. New options default to current behaviour.

## Licence and security contact

- **Licence:** MIT for `packages/` and for the engine files and `report-view.ts`, because the published packages include them. Each of those files starts with `// SPDX-License-Identifier: MIT`. Nothing else in the repo gets a licence.
- **`packages/LICENSE`:** MIT, "Copyright (c) 2026 Perseverance AI".
- **Third-party code:** each package ships `THIRD_PARTY_LICENSES` for the dependencies it bundles.
- **Security contact:** `SECURITY.md` names hello@perseveranceai.com.

## User agent

| | User agent | Runs from | Retry on 403/429 |
|---|---|---|---|
| Website | `Lensy/1.0 (+https://perseveranceai.com/bot)` | AWS | Once, as a browser |
| CLI | `Lensy-CLI/<version> (+https://perseveranceai.com/bot)` | The user's machine | Never |

Since PR #49 (2026-11-01), website scans leave from a fixed IP address. `/bot` tells site owners to allow user agent `Lensy/1.0` **and** that IP, and it already mentions `Lensy-CLI`. That rule stays as it is. The CLI has no fixed IP, so a site that blocks it is pointed to perseveranceai.com, where the allow rule applies. The CLI's user-agent string is defined in `packages/`, never in `agent-handler/`, so the REG-27 test (`single-user-agent.test.ts`, "only fetch-page.ts defines a Lensy user-agent string") keeps passing.

## Engine

The engine is these files in `backend/lambda/agent-handler/`. None imports AWS, LangChain, S3 or progress publishing (checked at `1d5a757`).

| File | Role | Status |
|---|---|---|
| `shared/fetch-page.ts` | Honest fetch, browser fallback (website only), error kinds | Edit E1 |
| `shared/html-content.ts` | Text, headings, sections, Markdown detection | Unchanged |
| `shared/markdown-source.ts` | Front matter, MDX cleaning, `{#id}` anchors, `~~~` fences, code-fence languages | **New** (E8) |
| `tools/collect-signals-v2.ts` | Network work for a page, giving `SignalsV2` | Edits E2, E5 |
| `tools/source-signals.ts` | `SignalsV2` for a source file, plus which checks and parts it measured | **New** (E9) |
| `tools/scoring-v2.ts` | Pure scoring (C1–C6, S1–S6), gate, tips, fix copy | Unchanged |
| `tools/report-v2.ts` | `buildScoringV2()`, `ScoringV2Fields`, `AgentPreview` | **New**, moved from `generate-report.ts` (E3) |
| `tools/check-registry.ts` | `CHECKS`: metadata for every check | **New** (E4) |

All engine files get the MIT header (E7). The test helpers `tools/__tests__/replay.ts` (edit E6) and `tools/__tests__/fixtures/*` (15 sites) are used in place.

### Engine edits

Each edit lands with its backend Jest test. Website output must not change.

- **E1 `fetch-page.ts`.** Add two fields to `FetchOptions`:
  - `userAgent?: string`: the honest attempt uses `opts.userAgent ?? HONEST_UA`.
  - `browserFallback?: boolean` (default `true`): when `false`, a 403 or 429 is returned with `errorKind: 'blocked'` and no browser attempt.
- **E2 `collect-signals-v2.ts`.** Add `userAgent?` and `browserFallback?` to `CollectOptions` and pass them into `fetchOpts`.
- **E3 `report-v2.ts`.** Move `buildScoringV2`, `ScoringV2Fields`, `AgentPreview` and `AGENT_WINDOW_CHARS` out of `generate-report.ts`, which imports and re-exports them. `report-v2.test.ts` imports from the new file.
- **E4 `check-registry.ts`.** See "Check registry" below.
- **E5 `netErrorChecks`.** The collector's `get()` takes the ids of the checks a request feeds. After 3 failed tries it adds them to the new field `SignalsV2.netErrorChecks: string[]`. The existing `netErrors` doesn't change.

  | Request | Checks |
  |---|---|
  | `robots.txt` | S1 |
  | Page with `Accept: text/markdown` | C2, plus C5 and C6 |
  | `.md` candidate | C3, plus C5 and C6 |
  | llms.txt candidates and sampled links | C4, plus C3 |
  | Sitemap files | S3, S4 |

  C5 and C6 count as unknown only when the failed request would have supplied what the agent receives. That means either content negotiation failed, or it didn't return Markdown and the `.md` request failed.
- **E6 `replay.ts`.** Change `HONEST = /^Lensy\//` to `/^Lensy(-CLI)?\//`.
- **E7 licence headers** on every engine file. Comment only.
- **E8 `markdown-source.ts`** (new, pure, no dependencies):
  - `splitFrontMatter(text)`: returns `{ body, meta }`. A minimal YAML reader for flat `key: value` lines; it keeps `title`, `description`, `date`, `lastUpdated`, `last_update` and `noindex`, and ignores nested values.
  - `cleanMdx(body)`: removes `import`/`export` lines, `{…}` expressions and JSX tags, keeping the text inside components. It reports whether build-time components were found (`<Tabs>`, `<Snippet>`, imported components).
  - `normalizeMarkdown(body)`: turns `~~~` fences into ```` ``` ````, and moves `{#custom-id}` heading suffixes out of the heading text into an id list.
  - `codeFences(body)`: the fence count and whether every fence has a language.

  `headingsFromMd` and `sectionWords` in `html-content.ts` stay unchanged. Source text is cleaned before it reaches them, so the website's scoring of served Markdown can't change.
- **E9 `source-signals.ts`** (new, pure). `buildSourceSignals(file)` takes `{ path, text, staticFiles: { llmsTxt?, robotsTxt? }, fileExists(relPath), platform }` and returns `{ signals: SignalsV2, measured: Record<CheckId, 'full' | number | false> }`. A number is the maximum points that apply. It is built from the cleaned Markdown:
  - `received`: Markdown format, its characters and words;
  - `receivedHeadings` and `htmlHeadings`: from `headingsFromMd`, with `subWithId` set to 0 and the id points excluded;
  - `sections`: from `sectionWords`;
  - `freshness.pageDate`: from front matter;
  - `llmsTxt`: from a static file, with links resolved through `fileExists`;
  - `robots`: from a static file, via `robotsAllows` with the page's path;
  - `tipFacts`: from `codeFences`;
  - `platform`;
  - every unmeasured field gets a neutral placeholder.

  Scoring then runs through the normal `scoreCodingAgents` and `scoreAiSearch`. `measured` decides which checks count:

  | Check | `measured` |
  |---|---|
  | C5, S5 | `full` |
  | C6 | 11 (H1 and level points; ids need the build) |
  | S4 | 6 (page date; sitemap needs the build) |
  | C4 | `full` if a static `llms.txt` exists, else `false` |
  | S1 | `full` if a static `robots.txt` exists, else `false` |
  | C1, S2, C2, C3, S3, S6 | `false` |

### Check registry

`tools/check-registry.ts` exports `CHECKS: CheckMeta[]`:

```ts
export interface CheckMeta {
  id: string;                         // 'C1' … 'S6'; a string, not a closed union (Req 7.1)
  source: 'lensy';                    // widened when another source lands
  score: 'codingAgents' | 'aiSearch';
  label: string;                      // equals scoring-v2.ts output
  max: number;                        // equals scoring-v2.ts output
  hostDependent: 'full' | 'partial' | false;   // local mode
  hostNote?: string;
  sourceNote?: string;                // shown in source mode when the check is partial or skipped
  measures: string;                   // from spec §4.2–4.4
  why: string;                        // from spec §3, no customer names
  evidence: { title: string; url: string }[];
}
```

- **Host dependence:** C2 is `full`. C3 and S3 are `partial`. Everything else is `false`.
- **Source-mode coverage:** comes from `buildSourceSignals().measured`. `sourceNote` explains it, for example "Heading ids are added by your build; check the build with --serve".

## Report view (website code, used in place)

New file **`frontend/src/report/report-view.ts`**: pure, with no imports, compatible with TypeScript 4.9 and `isolatedModules`, because the CRA build compiles it.

It holds the v2 functions moved out of `reportModel.ts`, unchanged:
- `ScoreCheck` and `ScoringV2` types;
- `AI_SEARCH_BOTS` and `AGENT_WINDOW_CHARS`;
- `readScoringV2`, `gateBannerText` and `previewSummary`;
- `v2SignalGroups` and `v2Recommendations`, which are now exported.

`reportModel.ts` imports them from there, so the website renders the same. The CLI's HTML and Markdown renderers call the same functions, which gives them the same grouping, fix order and wording as the website. The frontend e2e suite must pass unchanged.

The website's downloads (`exportReport.ts`, `markdown.ts`, `pdf.ts`) are not reused directly. They depend on the legacy v1 report, `process.env` flags and citations. The CLI reports follow the same section order from the shared view functions instead.

## Public API (`lensy-core`)

```ts
export interface CheckOptions {
  userAgent?: string;          // default `Lensy-CLI/<version> (+https://perseveranceai.com/bot)`
  fetchImpl?: typeof fetch;    // tests inject the fixture replayer
  timeoutMs?: number;          // overrides engine defaults (page 8000, sub-requests 10000)
  localMode?: boolean;         // set by --serve; also auto-detected from the host
  siteUrl?: string;            // local mode only
  now?: number;                // fixed clock for tests
}
// Core always calls the engine with browserFallback: false (Req 1.5).
export function check(url: string, options?: CheckOptions): Promise<Report>;
export function checkFromPage(page: PageInput, options?: CheckOptions): Promise<Report>;   // parity tests
export function checkSource(root: string, options?: { files?: string[]; now?: number }): Promise<Report[]>;
export { CHECKS } from '<engine>/check-registry';

export interface Report {
  reportVersion: 1;
  url: string;                 // as given, or source path relative to the checked folder
  finalUrl: string;            // after redirects (siteUrl + path in local mode; '' in source mode)
  checkedAt: string;           // ISO 8601
  engine: { scoringVersion: 2; commit: string };
  mode: 'url' | 'local' | 'source';
  scope: 'page';               // 'site' reserved (Req 7.3)
  status: 'ok' | 'blocked' | 'unreachable' | 'not-html';
  platform: 'vitepress' | 'docusaurus' | 'mintlify' | null;
  gate: { state: 'pass' | 'warn' | 'blocked' | 'skipped'; via?: 'honest' | 'browser'; honestStatus?: number; robotsBlocks: string[]; mismatch?: string };
  scores: { codingAgents: Score; aiSearch: Score };
  tips: { id: string; text: string }[];
  agentPreview?: { format: 'markdown' | 'html'; chars: number; approxTokens: number; windowShare: number; url: string };
  notes: string[];             // e.g. dev-server warning, "estimates" for MDX components, "how to check the full result"
  netErrors: string[];
}
export interface Score {
  score: number | null;        // null only when status !== 'ok'
  label?: 'local' | 'source' | 'partial';
  coveredMax: number;          // 100 unless checks are skipped, unknown or partial
  categories?: { id: string; label: string; score: number }[];   // Req 7.2; unused in phase 1
  checks: Check[];
}
export interface Check {
  id: string; source: 'lensy' | string; label: string; max: number;
  points: number | null;       // null when skipped or unknown
  status: 'pass' | 'warn' | 'fail' | 'skipped' | 'unknown';
  detail: string; fix?: string; // engine text, unchanged
  note?: string;               // hostNote, sourceNote, or "network error: <url>"
}
```

**Score rule:**
- When nothing is skipped, unknown or partial, `score` is the engine's score, so it matches the website exactly.
- Otherwise `score = round(100 × earned ÷ coveredMax)`, where `coveredMax` is the sum of the maximum points that apply. In source mode, C6 counts 11 and S4 counts 6.

### How `check()` works

1. **Fetch the page:** `fetchPage(url, { accept: ACCEPT_HTML, timeoutMs, userAgent, browserFallback: false })`.
   - 403 or 429 → `status: 'blocked'`.
   - A network error → `'unreachable'`.
   - A content type that isn't HTML → `'not-html'`.
2. **Build the `PageInput`** (final URL, body, headers, gate), then call `checkFromPage()`.
3. **Score:** `collectSignalsV2(page, { fetchImpl, timeoutMs, userAgent, browserFallback: false, now })`, then `buildScoringV2(signals)`.
4. **Map to `Report`:**
   - add each check's `source` from the registry;
   - mark the checks in `netErrorChecks` as `unknown`;
   - apply local mode;
   - recompute a score only where the score rule needs it.

**When the CLI can differ from the website:**
- **Network errors:** the CLI reports unknown checks and a partial score, where the website scores them 0.
- **Local and source modes.**
- **A site that refuses the honest agent on a sub-request.** The website retries as a browser; the CLI doesn't.

The first two are labelled in the output.

### How `checkSource()` works

1. **Find files:**
   - all `.md` and `.mdx` files under `root`;
   - skips `node_modules`, hidden folders and `.gitignore` entries (simple glob rules, no dependency).

   No files → the CLI exits 2.
2. **Find static files and platform:**
   - static files: `llms.txt` and `robots.txt` in `root`, `public/` or `static/`;
   - platform: from the config file name (`.vitepress/config.*`, `docusaurus.config.*`, `mint.json`, `docs.json`).
3. **Score each file:**
   - read it;
   - `buildSourceSignals()`, then `scoreCodingAgents`/`scoreAiSearch` and `tipsV2`;
   - apply `measured`, so unmeasured checks become `skipped` with the registry's `sourceNote`;
   - compute the scores with the `source` label and `coveredMax`.
4. **Add notes:**
   - estimates, when MDX build-time components were found;
   - "the build may add an H1 from the front-matter title", when there's a `title` but no `# H1`;
   - always, how to check the full result: build, then run `lensy check --serve <output>`, with the platform's command and output folder.
5. **No network:** `checkSource()` never calls `fetch`. A test asserts this.

## Local mode (`packages/core/src/local-mode.ts`)

- **Turns on when:** the host is `localhost`, `127.0.0.1` or `[::1]`, or `localMode: true`.
- **Registry `full` checks** (C2): `skipped`, with the note "depends on your hosting".
- **`partial` checks** (C3, S3): scored, with `hostNote`.
- **Gate:** `skipped`.
- **Score label:** `local`.
- **`siteUrl`:**
  - the engine runs with `finalUrl = siteUrl origin + path`;
  - a wrapping `fetchImpl` sends requests for the `siteUrl` origin to the local origin;
  - requests to any other origin get `TypeError('blocked in local mode')`, which makes them network errors, so those checks become `unknown`.
- **Dev-server note:** when the URL is `localhost` and `--serve` wasn't used, `notes` gets the warning from Req 2.8.

## CLI (`packages/cli`)

```
lensy check [urls...] [--urls-file f]
            [--serve dir [path...]] [--site-url url]
            [--source file-or-dir]
            [--html file] [--md file]
            [--user-agent s] [--timeout ms] [--concurrency n] [--no-color] [--no-usage]
lensy explain <checkId>
lensy usage on | off | status
lensy report-issue [--last] [--message text] [--email address] [--yes]
lensy --version
```

- **Concurrency:** 2 pages by default, at most 5.
- **Static server (`serve.ts`):**
  - Node's `http` module only, on `127.0.0.1` port 0.
  - Resolves `/path` to `path`, then `path.html`, then `path/index.html`.
  - Content type from a fixed extension map. Rejects `..` paths; anything outside `dir` gets a 404.
  - No content negotiation, and no `Link` or `X-Robots-Tag` headers.
- **`--serve` on a folder with no `.html` files:**
  - `.md` or `.mdx` files present → switch to `checkSource()`, with a one-line notice.
  - Neither present → exit 2, with build commands for VitePress (`npx vitepress build docs`, output `docs/.vitepress/dist`), Docusaurus (`npm run build`, output `build`) and Mintlify (`mintlify dev` for a local URL).
- **Text output (`render-text.ts`):**
  - several pages: a summary table (page, Coding agents, AI search, status), then each page;
  - colour from `picocolors`, off when stdout isn't a terminal, with `--no-color`, or with `NO_COLOR`;
  - no per-check code;
  - the layout is not a stable format.
- **HTML and Markdown reports (`render-html.ts`, `render-md.ts`).** Both are built from a single `ReportDoc` (`report-doc.ts`), which turns a `Report[]` into the shared structure using the report view:

  | Section | Source |
  |---|---|
  | Metadata | `reportVersion: 1`, tool, toolVersion, engineCommit, checkedAt, mode, and per page: url, status, codingAgents, aiSearch |
  | Summary | scores with labels and `coveredMax`; `gateBannerText`; `previewSummary` |
  | Both audiences, Coding agents, AI search | `v2SignalGroups` |
  | Fixes | `v2Recommendations` (each once, ordered by points lost; C1/S2 merged) |
  | Tips | `report.tips` |
  | Skipped and unknown checks | checks with those statuses, with their notes |
  | Notes | `report.notes` |

  - **HTML:**
    - one file with inline CSS, no `<script>`, and no external URLs (a test checks the output for `src=`/`href=` to `http`);
    - colours from the website tokens (`--bg #ffffff`, `--ink #141414`, `--accent #697075` and others), with a dark theme via `prefers-color-scheme`;
    - a system font stack instead of Plus Jakarta Sans, because fonts must not load from the web;
    - `@media print` styles;
    - metadata also in `<meta name="lensy:*">` tags.
  - **Markdown:**
    - YAML front matter, `##` per page, `###` per section, check tables, and `- [ ]` fixes;
    - plain ASCII status words, like the website download.
  - **Stability:** a golden-file test locks the structure of both formats for `reportVersion: 1`.
- **Exit codes:** 0 when every page was checked; 2 for invalid usage (decided before running); 3 when any page has `status !== 'ok'`.
- **Errors:**
  - Blocked: "This site's bot protection refused Lensy-CLI (HTTP 403), so this page wasn't checked. Run the audit at https://perseveranceai.com instead." It shows the real status code.
  - An engine exception counts as `unreachable` and prints "Lensy hit an internal error on <url>". The stack trace only appears with `LENSY_DEBUG=1`.

## Usage records

### CLI side (`packages/cli/src/usage.ts`)

- **Settings:** `~/.lensy/config.json` holds `{ "usage": "on" | "off", "installId": "<uuid>" }`. The file is created with mode 0600.
- **Consent prompt:**
  - Asked once, only when stdin and stdout are terminals and `CI` is unset.
  - Default No.
  - It lists the exact fields before asking.
- **When nothing is sent:**
  - the user hasn't answered, or answered no;
  - `--no-usage` or `LENSY_USAGE=0` is set;
  - the run isn't interactive and no choice was ever saved.
- **`lensy usage`:**
  - `on` creates `installId`;
  - `off` deletes it;
  - `status` prints the choice and the field list.
- **Payload,** one record per page:

```json
{
  "sessionId": "cli-<uuid v4>",
  "installId": "<uuid v4>",
  "cliVersion": "0.1.0", "engineCommit": "abc1234", "os": "darwin", "nodeMajor": 22,
  "mode": "url",
  "submittedUrl": "https://docs.example.com/guide", "finalUrl": "https://docs.example.com/guide/",
  "status": "completed", "reason": null, "httpStatus": 200,
  "codingScore": 85, "searchScore": 70, "scoringVersion": 2, "analysisTimeMs": 4210,
  "failedChecks": ["C2", "S6"], "skippedChecks": [], "unknownChecks": []
}
```

  For `local` and `source` modes, `submittedUrl` is the `--site-url` page URL if given. Otherwise it's the relative path, such as `/guide/start` or `guide/start.md`, and `finalUrl` is empty.
- **Sending:**
  - `POST https://api.perseveranceai.com/cli/usage`. `LENSY_API_URL` overrides the base URL for testing against gamma. No environment hostnames are built into the package;
  - sent after the page's result is printed;
  - at exit, the CLI waits at most 2 seconds for pending sends, then quits;
  - errors are ignored unless `LENSY_DEBUG=1`;
  - the exit code never changes.

### API side (`backend/lambda/api-handler`, `backend/lib/lensy-stack.ts`)

- **Route:** `POST /cli/usage` on the existing HTTP API, handled by a new `handleCliUsage()` in the API handler.
- **Validation:**
  - only the fields above are accepted, with types and lengths checked;
  - `sessionId` must match `^cli-[0-9a-f-]{36}$`, and `installId` must be a UUID;
  - URLs must be at most 500 characters and `http(s)`;
  - check lists must be at most 20 known check IDs;
  - `reason` must be one of `blocked-by-bot-protection`, `unreachable-url`, `not-html`, `no-source-files`, `internal-error`;
  - anything else → 400.
- **Rate limit:**
  - 500 records per hashed IP per day, set by the env var `CLI_USAGE_DAILY_LIMIT`;
  - counted in the existing `UsageTrackingTable` with the sort key `cli#<date>`, so it never uses up the website's scan allowance;
  - above the limit → 429.
- **Write:**
  - `PutItem` into `AuditLogTable` with `ConditionExpression: attribute_not_exists(sessionId)`, so a CLI record can never overwrite a website row;
  - the server sets `auditUrl` (= `finalUrl || submittedUrl`), `submittedAt`, `trafficSource: 'cli'` and `ipHash` (the existing `hashIp`);
  - it doesn't trust client values for these;
  - all other values are stored as strings, like `writeAuditLog`, and check lists are joined with commas;
  - no email is sent.
- **Permissions:**
  - `auditLogTable.grantWriteData(apiHandler)` and the `AUDIT_LOG_TABLE` env var;
  - the API handler has no read access to the audit log.
- **Logging:** a `CLI_USAGE` JSON log line with `sessionId`, `status` and `reason`. It doesn't include the raw IP, which the existing `REQUEST` log line already records.

### Custom domain (`backend/lib/lensy-stack.ts`)

- **Domain:** `api.perseveranceai.com` in prod and `gamma.api.perseveranceai.com` in gamma.
  - On 2026-11-01 the old "Dosthy API" CloudFront distribution, its DNS records and its certificate were removed. A local backup is in `.kiro/backups/`.
- **Resources:**
  - an `acm.Certificate` with DNS validation in the existing `hostedZone`;
  - an `apigwv2.DomainName` (regional) and an API mapping to `httpApi`'s default stage;
  - a `route53.ARecord` and an `AaaaRecord` aliasing `targets.ApiGatewayv2DomainProperties`;
  - a `CfnOutput` for the URL.
- **The website keeps its current `execute-api` URLs** in `.env.*`. Moving the website to the new domain is a separate, optional change.
- **Deployment:** through `deploy.yml`. Gamma deploys automatically and prod waits for approval. No manual resources.

## Support reports (`lensy report-issue`)

- **What it does:**
  - builds the report described in Req 4.12;
  - prints it in full and asks for confirmation (or `--yes`);
  - sends it to the existing `POST /console/feedback` on `api.perseveranceai.com`, with `message`, optional `email`, and `scanMetrics`, which holds the `--last` usage fields.
- **Size limit:** the CLI caps `scanMetrics` at 4 KB, because the endpoint doesn't limit it.
- **If sending fails, or the user declines:** the CLI writes the report to `./lensy-issue-<timestamp>.txt` and prints the path and hello@perseveranceai.com.
- **`--last` data:** read from `~/.lensy/last-run.json`, which every run overwrites with the usage fields of each page, even when usage records are off. The file is never sent except by `report-issue`.

## Keeping the website and the CLI in step (Req 6)

These run in **our PR checks** (`cli.yml`, alongside `ci.yml`).

| Guard | Where | Fails? |
|---|---|---|
| **Boundary:** every esbuild input outside `packages/` is an allowlisted engine file or `report-view.ts`, and none imports `@aws-sdk/*`, `@langchain/*`, `aws-lambda`, `s3-helpers`, `progress-publisher`, `publish-progress`, `react` or `process.env` | `core/test/boundary.test.ts` | Yes |
| **Registry coverage:** every engine check has a registry entry with the same label and max, plus `measures`, `why` and evidence | `core/test/registry.test.ts` | Yes |
| **Report coverage:** every `ScoringV2Fields` key is mapped into `Report` or on `WEBSITE_ONLY` | `core/test/report-shape.test.ts` | Yes |
| **Parity:** all 15 fixtures give the same per-check points, details and fixes as `buildScoringV2(collectSignalsV2(...))` and `expected.json` | `core/test/parity.test.ts` | Yes |
| **Report structure:** golden files for HTML and Markdown at `reportVersion: 1` | `cli/test/report-structure.test.ts` | Yes |
| **`docs/checks.md` up to date** (generated from the registry) | `cli/test/docs.test.ts` | Yes |
| **Triggers:** `cli.yml` runs on `packages/**`, the engine files, the fixtures, `frontend/src/report/report-view.ts` and `cli.yml` itself | workflow | Yes |
| **Drift warning:** `frontend/src/report/markdown.ts` changed but `packages/cli/src/render-md.ts` didn't | step in `cli.yml` | Advisory |
| **Steering:** `.kiro/steering/lensy-engine.md` | Kiro | n/a |

### Website features and the CLI

| Website feature | CLI phase 1 | Why |
|---|---|---|
| Two scores, C1–C6 and S1–S6, findings, fixes, platform fixes, tips, agent preview | Yes | Shared engine |
| Reachability gate and robots/server mismatch | Yes | Shared engine |
| Report grouping, fix order, banner and preview wording | Yes | Shared report view |
| Markdown download | Yes, with its own renderer on the shared view | The website renderer depends on the legacy report and CRA flags |
| HTML report | Yes (CLI only) | The website shows HTML live; no template exists to reuse |
| Browser retry on 403/429 | No | Decided: honest fetch only, with refused pages pointed to the website |
| PDF download | No | `--html` prints to PDF from a browser |
| AI citations, Jina rendering, legacy v1 categories, Bedrock/AWS features | No | Third-party services, AWS, or legacy code |

New website features follow one rule. If it's scored, it goes in the engine and the CLI gets it. If it needs AWS, a model or a third-party API, it's website-only, and it gets a row in this table.

## Build and tooling

- **Node:** 22 or later. **TypeScript:** strict, with `moduleResolution: bundler`, so the engine and report-view files compile in place.
- **Builds:** core with `tsup` (ESM plus bundled `.d.ts`, with the git short SHA as `ENGINE_COMMIT`); CLI with an esbuild bundle.
- **Runtime dependencies:** none for core; `commander` and `picocolors` for the CLI.
- **Dev dependencies:** `typescript`, `tsup`, `esbuild`, `vitest` and `gitleaks`.
- **Published files:** only `dist/`, `README.md`, `LICENSE` and `THIRD_PARTY_LICENSES`. Fixtures are never published.

## Testing

- **Parity:** must pass before anything else ships.
- **Core:**
  - blocked (403, 429): one request only, with no browser user agent;
  - unreachable;
  - not HTML;
  - a sub-request network error giving `unknown` checks and a `partial` score;
  - the user agent reaching every request.
- **Local mode:** the sample site in `core/test/sample-site/`. Covers the skipped and partial checks, `siteUrl` routing, the score formula, and other hosts becoming `unknown`.
- **Source mode:** `core/test/sample-source/`, a VitePress-like folder with `.md`, `.mdx`, front matter, `{#id}`, `~~~` fences, and `public/llms.txt` and `robots.txt`. Covers:
  - the `measured` table;
  - `coveredMax`;
  - the notes;
  - MDX cleaning;
  - no `fetch` calls;
  - that served-Markdown scoring is unchanged (the existing fixtures still pass).
- **Engine E8 and E9:** Jest tests in `backend/lambda/agent-handler/{shared,tools}/__tests__/`.
- **CLI (built binary):**
  - exit codes 0, 2 and 3;
  - `--html` is self-contained, with no external URLs and no `<script>`;
  - the golden structures;
  - `--no-color`;
  - `explain` for every id;
  - the usage prompt never appears without a terminal, or with `CI` set;
  - nothing is sent without opt-in;
  - the payload holds only allowlisted fields;
  - `report-issue` writes a local file when sending fails.

  Uses a local stub server.
- **API:** Jest tests for `handleCliUsage`: validation (400), the rate limit (429), the conditional write, server-set fields, and no email.
- **Website:** the e2e suite after the `report-view.ts` extraction and the `/bot` and privacy page changes, with tests per `AGENTS.md`.
- **Live (manual):** `npm run test:live` on the 15 fixture URLs. Our PR checks never run it.

## Release

- **npm organisation:** `perseverance-ai` (owner `perseveranceai`). Packages: `@perseverance-ai/lensy` and `@perseverance-ai/lensy-core`. Two-factor authentication must be on for every account that publishes.
- **First early-access version (0.1.0):**
  - Rakesh publishes it by hand from `packages/`, with `npm publish --access public`, core first;
  - after a dry run (`npm pack --dry-run`) and a secrets scan of the tarballs.
- **Design partner:** gets the install command, the README, and the `report-issue` instructions.
- **Later releases:**
  - `.github/workflows/lensy-release.yml` runs on a `lensy-v*` tag, in a protected `npm-release` environment that needs Rakesh's approval;
  - it uses npm trusted publishing (OIDC, no stored token), configured on both packages after the first publish, and adds provenance automatically.

## Phase 2: automation (not in phase 1)

- **Gates:** `--fail-under coding=N,search=N`, `--baseline`, `--max-drop`, `--write-baseline`, and exit code 1. When a gate fails and a page couldn't be checked, the exit code is 1.
- **Config:** `lensy.config.json`, with flags winning.
- **`--json`:** versioned like the reports, with additive changes only.
- **GitHub Action:** a `node24` runtime, a job summary, and one upserted PR comment marked `<!-- lensy-report -->`. It should recommend `--serve` or `--source`, because GitHub's runners use data-centre IP addresses that bot protection may refuse.
