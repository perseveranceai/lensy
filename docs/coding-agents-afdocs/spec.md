# Coding agents score from AFDocs

Status: built on `feat/coding-agents-afdocs`, in review.
Owner: Rakesh. Builder: Mahesh.

## Problem

Lensy's Coding agents score was six of our own checks (C1-C6). Fern, Mintlify, Document360 and Documentation.ai score coding-agent readiness with AFDocs, the open Agent-Friendly Documentation checks. Rakesh asked to build the Coding agents score on AFDocs, keep the Lensy checks AFDocs doesn't cover, and leave AI search as it is. This applies to the website and the CLI.

## Decisions

From Rakesh, 2026-11-03:

- Lensy wraps AFDocs. Users only ever run `lensy`; there is no AFDocs command.
- AFDocs runs on the one page the user submits (curated sampling with only that URL), so both scores describe the same page. Site sampling comes later.
- AFDocs is pinned at exactly 0.23.0, loaded with a dynamic `import()` in the Lambda and bundled into lensy-core for the CLI. Upgrades are deliberate and re-capture the fixtures.
- AFDocs checks get `source: 'afdocs'` in the check registry. AFDocs' MIT notice ships in `THIRD_PARTY_LICENSES`.
- The website shows AFDocs checks in the Coding agents list with an "AFDocs" label. No new sections.
- The column-bug test on this branch is REG-30.

From Mahesh, 2026-11-03:

- The score uses AFDocs' own formula: each check earns a share of its tier weight (critical 10, high 7, medium 4, low 2; a warning earns part), the score is weight earned over weight possible, and some critical failures cap it (no llms.txt caps it at 59). Lensy's own checks are added in the same tiers. Skipped checks leave both sides of the ratio, which is what a local build check needs later.
- AFDocs' `rendering-strategy` replaces C1 in Coding agents. S2 stays in AI search. The report shows them as one "Content without JavaScript" row with no AFDocs label, because the row mixes both.
- The only Lensy check added is `lensy-headings` (one H1, no skipped heading levels, weight 4). AFDocs' `section-header-quality` only looks inside tabs. H2/H3 ids, AGENTS.md, MCP config and code-language hints stay tips.
- `llms-txt-coverage` stays skipped. It reads the whole sitemap, which is about the site rather than the page and is the slowest part of a run.
- Speed settings: 20 llms.txt links, 200 ms between requests, 3 requests at a time.

## How fetching works

AFDocs has no option for a fetch function or a user agent, and sends every request through `globalThis.fetch` (`dist/http.js`). While an AFDocs run is active, `globalThis.fetch` is a dispatcher (`tools/afdocs-page.ts`). Requests made inside the run, tracked with `AsyncLocalStorage`, go through `honestFetch` in `shared/fetch-page.ts`, so they carry the caller's user agent (`Lensy/1.0` on the website, `lensy-cli/<version>` in the CLI) and never retry as a browser. Every other caller in the process gets the original fetch. The dispatcher is reference-counted, so overlapping CLI pages don't restore it early, and it is removed when the last run's work has finished, including after a timeout. `redirect: 'manual'` is passed through, so AFDocs' redirect check still works.

## Acceptance criteria

1. A website scan and `lensy check <url>` run AFDocs 0.23.0 on the submitted page only and give the same Coding agents checks and score.
2. Every AFDocs request carries the caller's user agent and goes through `fetch-page.ts`; nothing goes out as `afdocs/...`.
3. `globalThis.fetch` is the original again after every run, including when AFDocs throws or times out, and with overlapping runs.
4. `redirect: 'manual'` reaches the server unchanged.
5. Coding agents is AFDocs' checks plus `lensy-headings`, scored with AFDocs' formula.
6. If AFDocs fails or takes over 150 s, the scan still completes with C1-C6.
7. Every AFDocs check is in the registry with `source: 'afdocs'`, a label, its weight, what it measures and why.
8. Website report: AFDocs checks in the Coding agents group with an "AFDocs" label; Markdown and PDF downloads match the page; AI search unchanged.
9. CLI terminal, `--md` and `--html` show the AFDocs checks with the same label.
10. `THIRD_PARTY_LICENSES` in lensy-core lists AFDocs and every package bundled with it.
11. The report opens on one score tab and always shows two groups (REG-30).
12. Backend Jest, CLI Vitest and frontend e2e pass on a production build.

## How each criterion is tested

| Criterion | Test |
|---|---|
| 1 | `packages/core/test/parity.test.ts`: on the 5 pages with saved AFDocs runs, the CLI and the website engine give the same checks, points, findings, fixes and score |
| 2 | `afdocs-fetch.test.ts` (recording fetch, website and CLI user agents); `packages/core/test/check.test.ts` runs the real AFDocs module offline and fails if a request bypasses the CLI's fetch |
| 3, 4 | `afdocs-fetch.test.ts` |
| 5, 6 | `scoring-afdocs.test.ts` |
| 7 | `check-registry.test.ts`, `packages/core/test/registry.test.ts` |
| 8 | e2e S-11 and DL-09 |
| 9 | CLI golden files `packages/cli/test/golden/report.md` and `report.html`, `check-command.test.ts` |
| 10 | `packages/scripts/package-files.mjs` fails the build when a bundled package has no licence it can find |
| 11 | e2e REG-30 |
| 12 | pre-push suite |

The 5 saved AFDocs runs are in `backend/lambda/agent-handler/tools/__tests__/fixtures/afdocs/`. AFDocs 0.23.0 alone scores them Branch 100, Stripe 91, Docusaurus 59 (capped), Vitest 86, React 92.

## Out of scope

- Site-level sampling.
- Changes to AI search.
- Checking a local build (`--serve`), which is the next spec.
- An upstream change to AFDocs.

## Speed: tested, not built

AFDocs' checks fall into 5 dependency waves (declared `dependsOn` plus hidden reads of `ctx.previousResults` and shared caches):

| Wave | Checks |
|---|---|
| 1 | llms-txt-exists, markdown-url-support, content-negotiation, rendering-strategy, page-size-html, llms-txt-directive-html, llms-txt-directive-md, content-start-position, http-status-codes, redirect-behavior, auth-gate-detection |
| 2 | llms-txt-valid, llms-txt-size, llms-txt-links-resolve, llms-txt-links-markdown, page-size-transfer, embedded-data-serialization, tabbed-content-serialization, cache-header-hygiene, auth-alternative-access |
| 3 | page-size-markdown, single-fetch-completeness, markdown-link-portability, markdown-code-fence-validity, section-header-quality |
| 4 | markdown-content-parity |
| 5 | bot-protection-interference |

`llms-txt-directive-md` has to stay in wave 1: AFDocs runs it before its dependencies, so it works in standalone mode. Moving it later changed Docusaurus from fail to skip.

On 5 pages, 2 runs each, with at most 3 requests in flight across the run, every check status matched AFDocs' sequential run, and running waves in parallel was faster in 8 of 10 runs (about 10 to 65 percent). Without the run-wide limit, one Stripe run took 85 s and dropped from 91 to 87 because the site throttled it. The costs: it depends on AFDocs internals (`ctx.http`, `ctx.previousResults`), adds about 2 requests per scan, and the wave list has to be rechecked on every AFDocs upgrade. Not built until asked.

## Notes

Spike on 0.22.2 (2026-10-29, laptop, 50 links, coverage on):

| Page | AFDocs | Old C1-C6 | Time | Requests |
|---|---|---|---|---|
| Branch onboarding | 97 | 97 | 22 s | 67 |
| Stripe payments | 90 | 87 | 68 s | 107 |
| Docusaurus docs | 59 (cap) | 50 | 8 s | 14 |
| Vitest guide | 86 | 85 | 9 s | 26 |
| React learn | 92 | 95 | 26 s | 76 |

With the shipped options (20 links, `llms-txt-coverage` skipped): Vitest 86 in 27 s with 18 requests and Stripe 91 in 32 s with 55 requests through the compiled Lambda code. The CLI checks Vitest in 11 s.

After merge, scan these 5 pages on gamma and compare scores and times with the laptop runs. Bot protection may treat AWS traffic differently.
