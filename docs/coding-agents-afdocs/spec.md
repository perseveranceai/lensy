# Coding agents score from AFDocs

Status: built on `feat/coding-agents-afdocs`, not pushed. Parked while the CLI (`feat/lensy-cli`) is built.
Owner: Rakesh. Builder: Mahesh.

## Problem

Lensy's Coding agents score is six of our own checks (C1-C6). Fern, Mintlify, Document360 and Documentation.ai all score coding-agent readiness with AFDocs, the open Agent-Friendly Documentation checks. Rakesh asked (WhatsApp, 2026-10-29) to use AFDocs for this score, add what it misses from our checks, and park AI search until this is done.

## Decisions (2026-10-29)

- Score the one page the user submits, not a 50-page site sample, so both scores describe the same page.
- Use AFDocs' own formula (option A), plus Lensy checks in the same tiers.
- Show one Coding agents score. AFDocs' own number is stored as `afdocsScore`, not shown.
- AI search stays unchanged and parked.
- AFDocs checks may count even though "another tool has them". `docs/two-score-readiness/design.md` says otherwise; Rakesh's message overrides it for coding agents.
- Only one Lensy extra is scored: one H1 and no skipped heading levels (4 points). H2/H3 ids, AGENTS.md, MCP config and code-language hints stay tips.

## Acceptance criteria

1. A scan runs AFDocs 0.22.2 on the submitted page only (`samplingStrategy: 'none'`), not a site sample.
2. The Coding agents score uses AFDocs' formula (10/7/4/2 tiers, warn fractions, caps such as "no llms.txt caps at 59"), with Lensy's headings check added at 4 points.
3. With no Lensy checks added, our scorer gives exactly AFDocs' own score (fixtures: Branch 97, Stripe 90, Docusaurus 59, Vitest 86, React 92).
4. One Coding agents score is shown; AFDocs' own number is stored, not shown.
5. If AFDocs fails or takes over 150 s, the scan still completes with the old C1-C6 score.
6. The report lists every scored AFDocs check with points, failing checks first; skipped checks are left out.
7. Markdown and PDF downloads carry the same checks; the PDF has no "?" for AFDocs' arrows.
8. AI search score is unchanged.
9. The /bot page says AFDocs requests are sent as `afdocs/0.22.2` and what they fetch.

Verified on 2026-10-29: backend Jest 263/263 (`scoring-afdocs.test.ts` covers 2, 3, 5), frontend e2e 45/45 on a production build (S-11 covers 6 and 8, DL-09 covers 7).

## Out of scope

- Site-level sampling.
- Changing AI search.
- Letter grades.
- Overriding AFDocs' user agent (its API has no option for it).

## Before this branch can merge

1. **Rebase onto main.** Main now uses REG-27 to REG-29 (fixed outbound IP, PR #49 and #50). This branch's column-bug test is also called REG-27; renumber it to the next free id and fix its row in `docs/test-cases.md`.
2. **Engine rules from `feat/lensy-cli`** (`.kiro/steering/lensy-engine.md`) conflict with AFDocs: every request must go through `shared/fetch-page.ts`, and the CLI must name itself `Lensy-CLI/<version>`. AFDocs uses its own HTTP client and always sends `afdocs/0.22.2`. Rakesh decides whether AFDocs is website-only or the rule changes.
3. **Speed.** AFDocs adds about 5 to 30 s per page (15 to 55 requests, 28 checks run one after another, 200 ms between requests). Decide on the options below.
4. Scan the 5 spike pages on gamma after merge and compare scores and times; bot protection may treat AWS traffic differently from a laptop.

## Speed: tested, not built

AFDocs' checks fall into 5 dependency waves (declared `dependsOn` plus hidden reads of `ctx.previousResults` and shared caches):

| Wave | Checks |
|---|---|
| 1 | llms-txt-exists, markdown-url-support, content-negotiation, rendering-strategy, page-size-html, llms-txt-directive-html, llms-txt-directive-md, content-start-position, http-status-codes, redirect-behavior, auth-gate-detection |
| 2 | llms-txt-valid, llms-txt-size, llms-txt-links-resolve, llms-txt-links-markdown, page-size-transfer, embedded-data-serialization, tabbed-content-serialization, cache-header-hygiene, auth-alternative-access |
| 3 | page-size-markdown, single-fetch-completeness, markdown-link-portability, markdown-code-fence-validity, section-header-quality |
| 4 | markdown-content-parity |
| 5 | bot-protection-interference |

`llms-txt-directive-md` must stay in wave 1: AFDocs runs it before its dependencies, so it acts in standalone mode. Placing it later changed Docusaurus from fail to skip.

Results on 5 pages, 2 runs each, all requests capped at 3 in flight across the run: every check status matched AFDocs' sequential run in all 10 runs; parallel was faster in 8 of 10 (about 10 to 65 percent). Without the run-wide cap, one Stripe run took 85 s and dropped from 91 to 87 (throttled). Costs: relies on AFDocs internals (`ctx.http`, `ctx.previousResults`), about 2 extra requests per scan, and the wave list must be rechecked on every AFDocs upgrade.

Other options, each needing Rakesh's OK: 10 llms.txt links instead of 20; 50 ms instead of 200 ms between requests; a cap of 5 instead of 3.

## Notes

Spike (2026-10-29, laptop, curated single page, 50 links, coverage on):

| Page | AFDocs | Old C1-C6 | Time | Requests |
|---|---|---|---|---|
| Branch onboarding | 97 | 97 | 22 s | 67 |
| Stripe payments | 90 | 87 | 68 s | 107 |
| Docusaurus docs | 59 (cap) | 50 | 8 s | 14 |
| Vitest guide | 86 | 85 | 9 s | 26 |
| React learn | 92 | 95 | 26 s | 76 |

With the shipped options (20 links, `llms-txt-coverage` skipped), through the compiled Lambda code: Vitest 86 in 27 s / 18 requests, Stripe 91 in 32 s / 55 requests.
