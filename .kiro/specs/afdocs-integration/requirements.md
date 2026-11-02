# afdocs integration: requirements (stub)

Status: **not started.** This comes after Lensy CLI phase 1 (`.kiro/specs/lensy-cli/`). This file records the goal and the open questions so the spec can be written later.

## Goal

Base the Coding agents score on [afdocs](https://github.com/agent-ecosystem/afdocs), the reference tool for the [Agent-Friendly Documentation Spec](https://agentdocsspec.com/), without dropping Lensy's own score categories. The change lands in the engine, so the website and the CLI both get it (lensy-cli Requirement 6).

## What we know (afdocs 0.23.0, checked 2026-11-01)

- MIT licence, TypeScript, ESM only, Node 22+. API: `runChecks`, `createContext`, `computeScore`, `getAllChecks`.
- 28 checks in 7 categories: content discoverability, Markdown availability, page size, content structure, URL stability, observability, authentication. It implements spec v0.6.0.
- 0.x: the README warns that check ids, flags and output formats may change between minor versions.
- It checks whole sites: it samples pages from llms.txt and the sitemap (`random`, `deterministic`, `curated` or `none`). Lensy checks single pages.
- It fetches with `globalThis.fetch` and user agent `afdocs/<version>`. There's no fetch-function or user-agent option.
- It has `canonicalOrigin`, which works like our `--site-url`.
- Its checks overlap C2–C6: content negotiation, Markdown URLs, llms.txt checks, page size and headings.

## Open questions

1. **Score model.** How do afdocs checks and C1–C6 combine into one Coding agents score while keeping Lensy's categories? Options: afdocs categories as `categories` sub-scores with the C checks kept; afdocs checks replacing the overlapping C checks; or a separate third score.
2. **Scope.** Page only (`samplingStrategy: 'curated'` with the one URL), or site sampling as well? This affects the report's `scope` and run time.
3. **Fetching.** Lensy needs every request to go through `fetch-page.ts` (honest user agent, browser fallback on the website but not in the CLI, fixture replay, local-mode routing). Options: an upstream afdocs PR adding `fetchImpl` and `userAgent` options (preferred), or wrapping `globalThis.fetch` (fragile).
4. **Lambda compatibility.** The agent Lambda compiles as CommonJS (`module: node16`) on Node 23 in CI. afdocs is ESM only, so it needs a dynamic `import()` or a bundling step.
5. **Version churn.** Pin an exact afdocs version, record per-version parity fixtures, and decide how fast to follow upstream.
6. **Evidence.** Each afdocs check enters the check registry with `source: 'afdocs'`, its evidence and its host dependence. Its MIT notice goes in the CLI's `THIRD_PARTY_LICENSES` file.
7. **Website UI.** How the report page shows sub-scores and afdocs checks.

## Ready for this in lensy-cli phase 1

- The `Report` format allows any check id, a `source` per check, optional `categories` per score and a `scope` (lensy-cli Requirement 7).
- The CLI renders checks from the registry with no per-check code.
- The CLI stays at 0.x until this lands.
