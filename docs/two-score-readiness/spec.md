# Spec: two readiness scores (AI search and Coding agents)

Status: validated draft, 2026-10-22 (§12). No product code has changed yet.
Owner: Rakesh. Builder: Mahesh.
**Building with Kiro or Claude Code:** start from [`tasks.md`](tasks.md), a step-by-step task list for 3 PRs with "done when" checks. [`requirements.md`](requirements.md) and [`design.md`](design.md) are next to it. In Kiro, point the spec at these files, or copy them into your local `.kiro/specs/two-score-readiness/` (the repo deliberately doesn’t track `.kiro/specs`).
Prototype that produced every number here: [`prototype.mjs`](prototype.mjs). Run it with `node docs/two-score-readiness/prototype.mjs <url>` (Node 22+, no dependencies). Sources are listed at the end of §3.

## 1. Summary

Lensy gives one page one score out of 100: discoverability 40, consumability 40, structured data 20. That number mixes two audiences without saying so:

- **AI search engines** (ChatGPT search, Perplexity, Google AI Overviews) decide whether to cite a page.
- **Coding agents** (Claude Code, Cursor, Codex) read docs while writing code.

About 25 of today's 100 points are AI-search signals with weak evidence behind them: JSON-LD, OpenGraph, breadcrumbs and word count. Some of the strongest signals aren't scored at all: Markdown served on request, page size, freshness, and whether an honest agent can reach the page.

This spec replaces the single score with:

- **A reachability check**: can a declared agent fetch the page, and does robots.txt allow AI bots? It's shown as a banner, not folded into the scores (§4.1).
- **A Coding agents score (100)**: 6 checks.
- **An AI search score (100)**: 6 checks.

The AI-citations test leaves the main report for now. It stays available behind a flag.

**Principle:** every scored check must be backed by evidence we can cite or a test we ran. Overlap with other tools (Fern's AFDocs) is fine where the evidence points the same way. Checks aren't added because another tool has them.

## 2. Why now

A senior technical writer at Branch (help.branch.io, VitePress) got Lensy 75 and Fern Agent Score 100 for the same site.

- **The site is excellent for coding agents.** AFDocs 0.22.2 gives 100 (A+) over 50 sampled pages.
- **Lensy took 25 points** for page-structure heuristics (−11: two H1s and a 474-word homepage) and structured data (−14).
- **Two earlier scans were rejected as "unreachable".** Prod logs show HTTP 403s from Branch's Cloudflare.
  - Branch blocks clients that claim to be Chrome but don't behave like one; Lensy's fetcher does exactly that.
  - Honestly named agents (`afdocs/0.22.2`, `Claude-User`) get 200.
  - REG-17 (#42) normalises bare hostnames. That helps, but the 403s also hit a docs page with a full path, so the root cause is the fetcher's identity (§7).

## 3. Evidence behind the checks

Full notes, with links, are in the vault. The strongest sources:

| Claim | Evidence | Strength |
|---|---|---|
| JSON-LD barely affects AI citations | Ahrefs tracked 1,885 pages that added schema against 4,000 controls (May 2026): citations barely moved. Otterly: 6 of 7 AI platforms couldn't read schema when asked. arXiv 2609.35077 (about 2 million citations): structured data, FAQ and Core Web Vitals effects vanish under domain fixed effects. | Strong (controlled and large-sample) |
| Topic match and recency drive citations; formatting doesn't | arXiv 2605.25517: 252,000 controlled trials on 6 LLMs. Topical relevance and position dominate; recency is a consistent secondary positive; formatting-only edits have little impact. arXiv 2609.35077: prompt-content alignment is the dominant page-level predictor. | Strong |
| AI crawlers don't execute JavaScript | Vercel and MERJ: GPTBot and ClaudeBot fetch scripts but don't run them (Googlebot and Gemini do). **Our test:** Claude Code fetching redocly.github.io/redoc saw only the title. | Strong, and tested |
| Coding agents ask for Markdown | **Our test:** Claude Code sends `Accept: text/markdown, text/html, */*`. Checkly (via GoodBarber logs): Claude Code, Cursor and OpenCode send it; Codex, Gemini CLI, Copilot and Windsurf reportedly don't. Branch serves Markdown on request: 29 KB vs 279 KB of HTML. | Tested and secondary |
| Agents read a limited window | **Our test:** Claude Code read 100,000 of 265,000 characters of docs.python.org stdtypes per fetch, and had to page for the rest. | Tested |
| llms.txt helps agents, not crawlers | Two server-log studies: AI crawlers never requested llms.txt. Mintlify benchmark (vendor-run, 2,400 runs): agents guess llms.txt and `.md` URLs, and linking llms.txt from Markdown pages cut dead URLs by about 90%. | Medium |
| Sections are found by headings | **Our test:** a URL `#fragment` is never sent to the server; agents fetch the whole page and locate sections by heading text. AI search retrieves passages of roughly a heading plus its paragraphs (practitioner sources). | Tested and secondary |
| Freshness signals | Google uses sitemap `lastmod` only when consistently accurate; Bing says most sitemaps fake it with the generation date. Visible dates and `dateModified` are the other declared signals. | Medium |
| OpenGraph | No evidence AI search uses it. **Our test:** Claude didn't see the page's OG tags. | No evidence |
| Word count 500–2000 | Only correlational blog claims; the controlled study found formatting negligible. | Weak |

**Sources:**
- [Ahrefs: we tracked 1,885 pages adding schema](https://ahrefs.com/blog/schema-ai-citations/)
- [Otterly: schema markup's real impact on AI search](https://otterly.ai/blog/schema-markup-real-impact-ai-search/)
- [arXiv 2609.35077: what drives citations in production LLMs](https://arxiv.org/html/2609.35077v1)
- [arXiv 2605.25517: what gets cited (competitive GEO)](https://arxiv.org/html/2605.25517v1)
- [Saaslinks: llms.txt server-log study](https://saaslinks.net/blog/llms-txt-server-log-study)
- [Wislr: 48 days of AI bot logs](https://www.wislr.com/articles/ai-bot-behavior-log-analysis/)
- [SearchOptimo: do AI crawlers render JavaScript (Vercel/MERJ data)](https://searchoptimo.com/blog/do-ai-crawlers-render-javascript)
- [GoodBarber: do AI agents read Markdown (Checkly data)](https://www.goodbarber.com/blog/do-ai-agents-read-markdown-what-two-weeks-of-our-own-server-logs-say-a1622/)
- [Cloudflare: Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/)
- [Vercel: Markdown and agent discovery](https://vercel.com/docs/agent-resources/markdown-access)
- [Inside Mintlify's agent stack](https://theairuntime.com/p/inside-mintlifys-agent-stack)
- [How Claude Code eats the web](https://giuseppegurgone.com/claude-webfetch)
- [Stackmatix: freshness signals for answer engines](https://www.stackmatix.com/blog/content-freshness-signals-answer-engines)
- [Paz.ai: passage-level retrieval](https://www.paz.ai/glossary/passage-level-retrieval)

The tests marked "our test" were run on 2026-10-22, from a laptop, with Claude Code's own fetcher and `curl`.

## 4. The check set

### 4.1 Reachability (shown as a banner, not capped)

| Check | How measured | Result |
|---|---|---|
| Reachable by a declared agent | GET the page with `Lensy/1.0 (+https://perseveranceai.com/bot)`. If that returns 403 or 429, retry once with the browser user agent (§7). | **Pass:** the honest name got 2xx. **Warn:** the honest name was blocked but the browser user agent worked; the page is scored from the browser fetch and the banner says "Some AI agents may be blocked by your bot protection". **Blocked:** both were refused; there are no scores, and the scan ends with a "blocked by bot protection" card. |
| AI bot policy (robots.txt) | Evaluate robots.txt for OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot and Claude-User against this path. Most specific group, longest matching rule wins. | Feeds AI-search check S1. "robots.txt allows AI bots but the server refused our honest agent" is flagged as a mismatch. |

**Why warn instead of capping:**
- A block on Lensy's own name doesn't prove real agents are blocked. Branch's Cloudflare refused clients claiming to be Chrome but let `afdocs` and `Claude-User` through.
- Capping would punish exactly the sites that handle agents well.

We do **not** send other companies' crawler names. Firewalls verify real crawlers by IP, so impersonating them gives false results and is ethically grey.

### 4.2 Coding agents score (100)

| # | Check | Points | Scoring rule |
|---|---|---|---|
| C1 | Content without JavaScript | 20 | Raw HTML, with scripts, styles, nav, aside and site-chrome headers removed, has ≥150 words and no empty SPA root: 20. 40–149 words: 10. Otherwise 0. |
| C2 | Markdown on request | 15 | GET with `Accept: text/markdown` returns Markdown (content type markdown or plain, not HTML, has Markdown structure): 15. |
| C3 | `.md` version discoverable | 15 | A Markdown version exists (rel=alternate, Link header, or `<url>.md`) **and** is advertised (rel=alternate, Link header, or listed in llms.txt): 15. Exists but not advertised: 8. |
| C4 | llms.txt usable | 20 | Found at the root or docs subpath and not HTML: 8. Valid format (H1 and Markdown links): 4. Sampled links resolve, up to 8 checked: 4 × share. Size ≤50K characters: 4; ≤100K: 2. |
| C5 | Page fits one fetch | 15 | Size of what an agent receives (Markdown if C2 or C3 passes, else HTML text): ≤50K characters 15, ≤100K 10, more 0. **Under 40 words received: 0** (an empty page isn't "small"). |
| C6 | Sections findable | 15 | On what the agent receives: exactly one H1 5 (more than one 2). No heading-level skips 6 (one skip 3), **counted only when there are at least 2 headings**. Share of H2/H3 with `id` attributes × 4. |

### 4.3 AI search score (100)

| # | Check | Points | Scoring rule |
|---|---|---|---|
| S1 | AI search bots allowed | 20 | 20 × the share of the six bots in §4.1 that robots.txt allows for this path |
| S2 | Content without JavaScript | 20 | Same rule as C1 |
| S3 | Indexable | 25 | Not noindex (meta robots or `X-Robots-Tag`): 10. If noindex, the whole check is 0. Canonical present: 7. Page listed in the sitemap: 8. Follow robots.txt `Sitemap:` lines and sitemap indexes, at most 12 files. |
| S4 | Freshness declared | 15 | See §4.4 |
| S5 | Answer-ready sections | 15 | On the **HTML**, which is what crawlers receive: one H1 4 (more than one 2). No skips 4 (one skip 2), counted only when there are at least 2 headings. Median words per H2/H3 section: 40–500 7; under 40 or 501–900 4; over 900 1; no H2/H3 sections 0. |
| S6 | JSON-LD | 5 | Parseable JSON-LD with an `@type`: 3. Has `dateModified`: 2. |

### 4.4 Freshness (S4) in detail

Lensy can't know whether a page is *actually* current. It checks whether freshness is **declared, and declared believably**. Age alone is not scored: an old page about a stable API isn't a problem.

| Sub-check | Points |
|---|---|
| A date in the raw HTML: `dateModified` (JSON-LD), `article:modified_time`, `<time datetime>`, or visible "Last updated / Updated on" text | 6 |
| This URL's sitemap entry has `<lastmod>` | 4 |
| Sitemap `lastmod` values are believable: present and not all identical (a one-URL sitemap counts as believable). All identical means a generated timestamp: 0 and a warning. | 3 |
| Page date and this URL's `lastmod` agree within 7 days | 2 |

Shown, not scored: the age ("last updated 14 months ago"), and a tip to review pages older than about 18 months.

Fix copy per platform, e.g. VitePress `lastUpdated: true` (visible date plus git-based sitemap `lastmod`).

### 4.5 What changes from today

| Today | Points today | New |
|---|---|---|
| llms.txt | 15 | C4 (20). Coding agents only. |
| Sitemap | 8 | Part of S3 |
| Canonical | 5 | Part of S3 |
| Meta robots noindex | −5 | Part of S3 (noindex = 0) |
| Markdown availability | 12 | C3 (15) |
| Content negotiation | detected, unscored | C2 (15) |
| Single H1 | 12 | Part of C6 and S5 |
| Heading nesting | 8 | Part of C6 and S5 |
| Not JS-rendered | 10 | C1 (20) and S2 (20) |
| Word count | 6 | **Dropped.** Very thin pages (<100 words) get a tip. |
| Internal link density | 4 | **Dropped** (no evidence found) |
| JSON-LD + schema completeness | 5 + 2 | S6 (5) |
| OpenGraph | 10 | **Tip only** (social previews) |
| Breadcrumb schema | 3 | **Dropped** |
| Text-to-HTML ratio | detected | Folded into C5 |
| Code blocks, language hints | detected | Tip (plausible, unverified) |
| AGENTS.md, MCP config, llms-full.txt | detected | Tips, unchanged |
| Bot access (robots.txt) | prerequisite | Gate plus S1, using AI **search** bots rather than training bots |
| AI citations test | shown separately | Hidden behind a flag (§8.3) |
| *(new)* Reachability for an honest agent | – | Gate |
| *(new)* Page size | – | C5 |
| *(new)* Freshness | – | S4 |

## 5. Nine-page comparison (prototype, 2026-10-22)

The current scores come from the real `check_ai_readiness` and `generate_report` code, run locally with stubbed S3. The proposed scores come from [`prototype.mjs`](prototype.mjs). AFDocs 0.22.2 is shown for reference only; "capped" means AFDocs couldn't sample enough pages from that start URL, so its number isn't representative.

| Page | Today (disc/cons/struct) | Coding agents | AI search | AFDocs |
|---|---|---|---|---|
| vitepress.dev/guide/getting-started | 86 (36/40/10) | 85 | 95 | 59 capped |
| vitest.dev/guide/ | 69 (23/40/6) | 85 | 68 | 86 |
| mintlify.com/docs/quickstart | 96 (40/37/19) | 100 | 100 | 59 capped |
| buildwithfern.com/learn/docs/getting-started/overview | 89 (40/37/12) | 94 | 90 | 59 capped |
| docs.stripe.com/payments | 83 (36/37/10) | 87 | 80 | 88 |
| docusaurus.io/docs | 67 (13/40/14) | 50 | 98 | 59 capped |
| react.dev/learn | 67 (28/29/10) | 95 | 70 | 91 |
| help.branch.io/ (Ara's scan) | 75 (40/29/6) | 96 | 75 | 100 |
| help.branch.io/account-hub/onboarding-guide | 75 (40/29/6) | 97 | 78 | 100 |

What the split shows:
- **Opposite profiles behind similar totals.**
  - Docusaurus: coding 50 (no llms.txt and no Markdown) but AI search 98.
  - React and Branch: strong for coding agents, weaker for AI search.
- **Freshness is the most common AI-search gap.** 0/15 for Stripe, React and Branch (891 sitemap URLs, none with `lastmod`). VitePress and Mintlify score in full.
- **Biggest coding-agent gaps:**
  - No Markdown on request: VitePress, Vitest, Docusaurus.
  - `.md` not advertised: Stripe.
  - Heading skips: Fern (2), Branch docs page (1).
- **Independent agreement:** where AFDocs sampled properly, its scores land close to the Coding agents score (Stripe 88 vs 87, React 91 vs 95, Vitest 86 vs 85, Branch 100 vs 97). This is a sanity check, not a target.

**Still to verify before shipping:** React's "no sitemap found". An early check hit a DNS error, so confirm `react.dev/sitemap.xml` and its robots `Sitemap:` line.

## 6. Data model

### 6.1 `report.json` (`generate-report.ts`)

Add, alongside the existing fields, so old consumers keep working during rollout:

```ts
scoringVersion: 2,
scores: {
  codingAgents: { score: number, checks: CheckResult[] },
  aiSearch:     { score: number, checks: CheckResult[] },
},
gate: {
  state: 'pass' | 'warn',   // 'blocked' scans end before a report is written (§7)
  honestStatus: number,
  browserStatus?: number,
  robotsBlocks: string[],   // which of the six AI bots robots.txt disallows for this path
  mismatch?: string,
},
// CheckResult = { id: 'C1'..'C6' | 'S1'..'S6', label, points, max, status: 'pass'|'warn'|'fail', detail, fix? }
```

- `overallScore` stays during the transition and is set to the AI search score, so legacy readers and the audit log don't break. Remove it after the UI migration lands.
- `scoreBreakdown` is kept until no client reads it.

### 6.2 Audit log (`agent.ts` `writeAuditLog`)

Add `codingScore`, `searchScore` and `scoringVersion`. Separately from scoring, but in the same release, add the fetch fields from §7.

### 6.2a Other readers of the old score

| Reader | What it does today | Change |
|---|---|---|
| `FeedbackWidget.tsx` and the feedback email (`api-handler/index.ts:1598`) | Send and print "Overall Score: N/100" | Send and print both scores |
| Legacy Step Functions pipeline (`report-generator`, `ai-readiness-checker`, used only when `USE_AGENT=false`; the default is `true`) | Computes its own single score | Out of scope. It stays as-is, and the plan is to remove it separately. |
| `analyze-dimensions.ts` (v1 content-quality dimensions) | Has its own `overallScore` | Unaffected |

### 6.3 Signal collection (`check-ai-readiness.ts`, `detection-engine.ts`)

**Reuse what exists:**
- The content-negotiation, link-alternate and direct `.md` probes (`detection-engine.ts:304`).
- Mapping the page in llms.txt (`classifyPageMapping`).
- Sitemap fetching.

**Add:**
1. llms.txt link sampling and size.
2. Received-content size.
3. Heading ids.
4. HTML-based section lengths.
5. Sitemap-index walking with `lastmod` collection.
6. Page date extraction.
7. robots.txt evaluation for the six AI search bots.

**Fix in the same change** (bugs found while prototyping and already in production code):
- `analyzeConsumability(…, false, …)` hardcodes `llmsTxtFound`, so Markdown listed in llms.txt never counts as discoverable (`check-ai-readiness.ts:254`).
- `checkUrl` treats any 2xx as "found", so soft-404 HTML pages can pass as llms.txt, sitemap or `.md`. Validate content type and body.
- Heading parsing must keep an article `<header>` that holds the H1 (Docusaurus, React) and drop only site-chrome headers.
- Network errors must mean "retry or unknown", never "not found".

## 7. Fetcher change (ships first, independently)

1. **Fetch with an honest name first:** `Lensy/1.0 (+https://perseveranceai.com/bot)` in `agent.ts` (prefetch) and `check-ai-readiness.ts` (`FETCH_HEADERS`, `checkUrl`), through one shared helper.
2. **On 403 or 429, retry once** with the current browser user agent.
3. **If still blocked:** reject with a new reason, `blocked-by-bot-protection`, and the UI message "This site's bot protection blocked our checker (HTTP 403)". Today it says `unreachable-url`.
4. **Audit rows:**
   - `submittedUrl`: the URL as typed. Today the row stores the URL after redirects, which made a slash-form success look like a no-slash one.
   - `finalUrl`: the URL after redirects.
   - `httpStatus`: the prefetch status.
   - `ipHash`: already computed in `runAgent`.
5. **Publish `/bot` on perseveranceai.com:** what the checker does, its user agent, and how to allow it.

Note: Cloudflare also weighs the connection fingerprint. On 2026-10-22, curl with the Lensy name got 403 while Node's fetch with the same name got 200. Test from the Lambda runtime on gamma, not only locally.

## 8. Report UI migration

### 8.1 Hero (`AppRoutes.tsx`, `ScanReport`, around line 800)

- Today: two hero cards, the **readiness score** (`realScore`, line 802) and **AI citations** (line 805).
- New: two score cards, **AI search N/100** and **Coding agents N/100**, each with a one-line description of who it's for.
- Clicking a card filters the signal list below to that score's checks.
- `view` gains `'coding'` and `'search'`; `'citations'` and `'citations-loading'` remain only behind the flag.

### 8.2 Banner and signal groups (`reportModel.ts`, `buildReportModel`)

- **The bot-access banner** (line 910) becomes the **reachability gate banner**:
  - honest-agent status;
  - the six AI search bots' robots.txt policy;
  - the mismatch warning;
  - the existing JavaScript-blocked message.
- **Signal groups** change from "Structured data / Discoverability / Content quality" to three cards:
  - **Both audiences**: content without JavaScript, headings and sections.
  - **Coding agents**: C2–C5.
  - **AI search**: S1, S3, S4, S6.
- Each signal row shows `points/max`.
- `SIGNAL_IMPACT` (`generate-report.ts:47`) is regenerated from the new weights.
- `fixForSignal` gets fix copy for C2–C6 and S4 (platform-specific where detected: VitePress, Docusaurus, Mintlify).
- **"What an agent receives" preview** under the Coding agents card:
  - the received format (Markdown or HTML);
  - its size in characters and approximate tokens;
  - where a 100K-character window would cut off.
  - It's cheap to build from C5 data, and it makes the score concrete.

### 8.3 AI citations

- Citations already don't run during a scan: the pipeline takes `skipCitations` (`agent.ts:391`), and the report runs them on demand. **This change is UI-only:**
  - Hide the citations card (`AppRoutes.tsx:805`) and the citations views behind `REACT_APP_CITATIONS_ENABLED`, a build-time flag that defaults to off in `.env.gamma` and `.env.production`.
  - Keep the code and the on-demand API route.
  - When the flag is off, the report download no longer offers or triggers citations (`useReportDownload.ts`). The files leave citations out rather than saying "could not run".
- Revisit when citations can run against a fixed query set per site with repeated runs.

### 8.4 Downloads (`exportReport.ts`, `markdown.ts`, `pdf.ts`)

- These share `buildReportModel`, so the groups change automatically.
- Update the headline to show both scores, the gate, and the agent preview summary.
- Keep H-001's rule that the page and the files agree.

### 8.5 Other surfaces

- **Home page tiles** (`AppRoutes.tsx:993`): "Discoverability / Content quality / Structured data" become "AI search / Coding agents / Reachability".
- **Education and research pages** (`AppRoutes.tsx` around 1091): remove or correct claims the evidence contradicts.
  - "JSON-LD markup increases rich snippet visibility by 20–30%" contradicts the controlled data.
  - Regenerate `/education/*.md` (REG-08).
- **llms.txt and site copy** that say "score out of 100" (line 962): change to "two scores out of 100".

### 8.6 Old reports

Scan data expires after 30 days (#41), but `/results` can reload a `report.json` without `scoringVersion: 2`:
- Render it with the legacy view and a "Re-scan to see the new scores" note.
- Don't recompute old reports.

## 9. Tests (per AGENTS.md)

Rules from AGENTS.md:
- Write or update e2e tests in the same commit.
- Bug fixes get the next REG id, plus a row in `docs/test-cases.md`.
- Never sign off on `npm start` alone.
- Check both themes and 375 px for visual changes.

### 9.1 New: scoring unit tests (backend Jest)

`backend` has `"test": "jest"` but no tests yet. Add `backend/lambda/agent-handler/tools/__tests__/` with **pure-function tests over saved fixtures**, with no network, so scores are deterministic:
- **One fixture set per test page:** HTML, Markdown response, robots.txt, sitemap and llms.txt, captured from the 9 pages above. Each asserts the C1–C6 and S1–S6 points shown in §5.
- **Edge fixtures:**
  - H1 inside an article `<header>`;
  - a site-chrome `<header>` containing a `<nav>`;
  - a sitemap whose `lastmod` values are all identical;
  - a sitemap index;
  - soft-404 HTML returned for `/llms.txt`;
  - noindex in `X-Robots-Tag`;
  - an llms.txt over 100K characters;
  - robots.txt with a specific-bot group overriding `*`;
  - Markdown with a heading-level skip.
- **Wiring:** add `npm --prefix backend test` to `scripts/pre-cr.sh` and to CI, next to the backend typecheck.

### 9.2 E2E (`frontend/e2e/`)

**Updates:**

| Case | Change |
|---|---|
| S-02 | Report shows **two** score cards (AI search, Coding agents), the reachability banner, three signal groups, and points on each signal |
| S-03 | **Retired while citations are off**, recorded in `test-cases.md` with a pointer to this spec rather than marked `skip`; AGENTS.md forbids untracked skips. Replace it with an assertion that no citations card renders. Bring S-03 back when the flag turns on. The flag is build-time, so a flagged run needs its own build. |
| S-06 | At 375 px both score cards and the agent preview fit with no horizontal scroll |
| S-08 | Reloading `/results` keeps both scores |
| download.spec | Markdown and PDF show both scores and match the page (H-001). Add a v2 fixture `report-stripe-v2.json`; keep the v1 fixture for the legacy test. |

**New cases:**

| Id | What it checks |
|---|---|
| S-09 [auto] | Clicking a score card filters the signal list to that score's checks. Uses an injected v2 fixture, like `download.spec.ts`. |
| S-10 [auto] | A v1 `report.json` (today's `report-stripe.json`) loaded at `/results` shows the legacy view with the re-scan note |
| REG-18 [auto] | Sites behind bot protection (Cloudflare) were rejected as "unreachable" because the fetcher pretended to be Chrome (Branch, 2026-10-21). Two parts, because e2e runs against gamma, whose Lambda can't reach a local fixture server. **Unit (Jest):** the shared fetch helper with a mocked `fetch`. 403 for the browser UA and 200 for `Lensy/1.0` gives pass. 403 for `Lensy/1.0` and 200 for the browser UA gives warn. 403 for both gives `blocked-by-bot-protection`. A network error is never reported as a block. **UI (Playwright):** using the `download.spec.ts` pattern (`routeWebSocket` plus `page.route`), a mocked rejected status with reason `blocked-by-bot-protection` shows the bot-protection card, not "unreachable". A v2 fixture with `gate.state: 'warn'` shows the warn banner. |
| REG-19 [auto] | Markdown listed in llms.txt never counted as discoverable (hardcoded `llmsTxtFound=false`). Unit test plus a report assertion. |
| REG-20 [auto] | A page's H1 inside an article `<header>` was ignored (found while prototyping). Unit test with the Docusaurus fixture. |

Both themes: S-01 already covers themes. Add screenshots of the new hero in light and dark to the visual check.

### 9.3 `docs/test-cases.md`

- Add rows S-09, S-10 and REG-18 to REG-20.
- Update S-02, S-03 and S-06.
- **Add test URLs.** U-10 (`https://help.branch.io`) is already used by REG-17 but missing from the URL table, so add its row too.
  - U-11 `https://help.branch.io/account-hub/onboarding-guide` (behind bot protection; strong coding score, freshness 0);
  - U-12 `https://docusaurus.io/docs` (no llms.txt or Markdown; strong AI search);
  - U-13 `https://vitepress.dev/guide/getting-started` (freshness pass; no content negotiation).

### 9.4 Before prod

- Run the 9 pages on gamma with the new scorer. Each must be within ±3 of §5 or explained.
- Run the pre-push suite (`cd frontend && npm run pre-cr`) on a production build.

## 10. Rollout

1. **PR 1, fetcher (§7):**
   - honest user agent with browser fallback;
   - the `blocked-by-bot-protection` reason and message;
   - the audit fields;
   - REG-18.
   - Independent of scoring; fixes the Branch case.
2. **PR 2, scoring v2 backend (§4, §6):**
   - writes `scores` and `gate` alongside the old fields;
   - includes the bug fixes in §6.3;
   - unit tests (§9.1);
   - REG-19 and REG-20.
3. **PR 3, report UI (§8):**
   - two score cards, regrouped signals, the agent preview;
   - citations behind the flag;
   - downloads, home tiles and education copy;
   - e2e updates (§9.2).
4. **On gamma:** run the 9 pages and compare with §5.
5. **Prod deploy** after a human approval (AGENTS.md: agents never deploy or approve prod).
6. **After a week:** remove `overallScore` and `scoreBreakdown` once nothing reads them.

## 11. Open questions

1. **Reachability:** decided during validation: warn, don't cap (§4.1). Open: should the warn state also link to a "how to allow Lensy and AI agents" page per CDN (Cloudflare, Fastly, Akamai)?
2. **Which bots S1 includes:** should Google-Extended count? It controls Gemini training and grounding, not AI Overviews.
3. **Freshness on JS-rendered dates:** sites that render "Last updated" only in JavaScript fail S4. Intended, since crawlers can't see it, but say so in the copy.
4. **Site-level sampling:** Lensy still scores one page. Should the Coding agents score sample 5–10 pages from llms.txt or the sitemap, like AFDocs does? It's more representative but slower.
5. **Code-block language tags:** score them for API reference pages if evidence appears; tip only for now.
6. **Citations:** criteria for bringing it back (a fixed query set, repeated runs, cost per scan).

## 12. Validation log (2026-10-22)

The spec was checked end to end before handing it to engineering.

**1. Rules vs prototype.** Each scoring rule in §4 was compared line by line with the prototype that produced §5. Found and fixed:
- S5's under-40-words case was undefined.
- A one-URL sitemap was wrongly marked "not believable".
- **The reachability gate capped scores.** Changed to a warn state (§4.1), because a block on Lensy's own name doesn't prove real agents are blocked.

**2. Edge cases from `test-cases.md`.** These exposed two rule bugs, both now fixed in §4.2 and §4.3:
- An empty JavaScript-only page earned C5's full 15 for being "small".
- "No heading skips" paid out for pages with no headings.

| Test URL | Coding agents | AI search | Behaves as expected? |
|---|---|---|---|
| U-1 docs.stripe.com/api | 94 | 76 | Yes: Markdown, llms.txt and content negotiation; no freshness signal |
| U-2 docs.github.com/en/rest | 96 | 62 | Yes. No canonical tag and no sitemap (both confirmed 404/absent by hand). |
| U-4 redocly.github.io/redoc (JS-only) | **0** (was 21 before the fix) | 30 | Yes: nothing for coding agents; AI search gets only bots-allowed and indexable points |
| U-5 lua.org manual (no robots.txt) | 28 | 63 | Yes: no robots.txt means bots allowed; the 263K-character page fails C5; 10 H1s |
| U-6 reddit.com/dev/api (blocks AI bots) | 26 | 48 | Yes: robots.txt blocks all six AI bots, so S1 = 0 |
| U-7 library.zoom.com (Markdown alternate) | 91 | 80 | Yes |

**3. Stability.** All 9 validation URLs were scored twice: identical scores and identical per-check points. React, Branch and Docusaurus also matched the §5 run from earlier the same day.

**4. Facts checked by hand:**
- `react.dev/sitemap.xml` is 404 and its robots.txt has no `Sitemap:` line, so "no sitemap" is correct.
- docs.github.com has no canonical tag and no sitemap.
- Docusaurus's H1 is inside an article `<header>`.
- help.branch.io's sitemap has 891 URLs with no `lastmod`.

**5. Buildability.** Checked against `origin/main` (c18d6c0):
- Every file and line cited in §6–§8 exists as described.
- The UI e2e cases can use the existing fixture-injection pattern (`download.spec.ts`).
- The fetcher's fallback can't be e2e-tested against gamma, so REG-18 is split into a unit test and a UI test (§9.2).
- Citations are already on demand (`skipCitations`), so §8.3 is UI-only.
- The legacy pipeline, the feedback email and the `FeedbackWidget` score were missing; now covered in §6.2a.
- U-10 is already used by REG-17, so the new URLs are U-11 to U-13.

**Known limits of this validation:**
- The prototype ran from a laptop, not the Lambda runtime. Cloudflare weighs IP and connection fingerprint, so the fetcher must be re-tested on gamma (§7).
- AFDocs comparisons marked "capped" aren't representative.
- Weights are a first proposal (§11). Validation shows they behave sensibly; it doesn't show they're optimal.

## 13. Out of scope

- Changing the doc-confidence gate or SPA rendering via Jina.
- New AI-citation engines.
- Any production deployment.
