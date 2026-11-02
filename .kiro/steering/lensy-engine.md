---
inclusion: fileMatch
fileMatchPattern: "{backend/lambda/agent-handler/**/{fetch-page,html-content,markdown-source,collect-signals-v2,source-signals,scoring-v2,report-v2,check-registry}.ts,frontend/src/report/report-view.ts}"
---

# This file is shared by the website and the CLI

The website and the `lensy` CLI (`packages/`) both run this file. A change here ships to both.

## Shared files

Engine, in `backend/lambda/agent-handler/`:
- `shared/fetch-page.ts`: every request to the site being checked
- `shared/html-content.ts`: text, headings, sections, Markdown detection
- `shared/markdown-source.ts`: front matter, MDX cleaning, heading anchors and fences, for source files
- `tools/collect-signals-v2.ts`: all network work for a page, giving `SignalsV2`
- `tools/source-signals.ts`: `SignalsV2` for a `.md`/`.mdx` source file, and which checks it can measure
- `tools/scoring-v2.ts`: pure scoring (C1–C6, S1–S6), gate, tips, fix copy
- `tools/report-v2.ts`: `buildScoringV2()` and the report fields built from it
- `tools/check-registry.ts`: one entry per check (id, label, max points, score, source, host and source-mode notes, explanation, evidence links)

Report view, in `frontend/src/report/report-view.ts`: check grouping, fix order, the reachability banner and the agent preview line. It's used by the website's report and the CLI's HTML and Markdown reports.

Each file starts with `// SPDX-License-Identifier: MIT`, because the CLI's npm package includes it. Keep that line.

## Rules

- **Keep it pure.**
  - Don't import AWS SDKs, LangChain, `s3-helpers`, `progress-publisher` or `publish-progress`, React, or `process.env`.
  - `report-view.ts` imports nothing.
  - Make network calls only through `fetch-page.ts`, with `fetchImpl` injectable.
  - The CLI's boundary test fails otherwise.
- **No secrets or private data.** The CLI publishes this code to npm. Never put credentials, API keys, AWS account IDs, internal hostnames (API Gateway URLs, gamma or other environment URLs) or customer names in these files, including comments and fix text.
- **Anything scored belongs here.** That covers checks, points, findings, fixes, gate state, tips and the agent preview. Other website code (`generate-report.ts`, `check-ai-readiness.ts`, the rest of the frontend) may display results but must not compute them.
- **Reuse before writing.** Before adding a helper, check these files for one that already does the job. The repo has older duplicates of robots.txt, sitemap and Markdown-alternate logic in `detection-engine.ts`, `check-ai-readiness.ts` and the sitemap Lambdas. Don't copy from them.
- **Adding or changing a check:**
  - start from `docs/two-score-readiness/spec.md`;
  - update `check-registry.ts` in the same PR, with label and max points matching what `scoring-v2.ts` returns;
  - say what source mode can measure (`source-signals.ts` and `sourceNote`);
  - add the scoring test in `tools/__tests__/`.
- **Adding a field to the report output:** map it into the CLI report in `packages/core/src/report.ts`, or add it to that file's `WEBSITE_ONLY` list.
- **Changing requests** (URLs, Accept headers, user agent, retries): keep `netErrorChecks` right (which checks each request feeds), then run both suites: `cd backend && npm test` and `cd packages && npm test`.
- **Don't change `headingsFromMd` or `sectionWords` for source files.** Clean source text in `markdown-source.ts` instead, so the website's scoring of served Markdown stays the same.
- **Keep website changes backwards-compatible.** Change no existing `report.json` field unless the website changes in the same PR. New options default to the website's current behaviour.
- **Fetching is honest.** The website names itself `Lensy/1.0` and may retry once with a browser user agent on 403 or 429. The CLI names itself `Lensy-CLI/<version>` and never retries. Never send other companies' crawler names (GPTBot, ClaudeBot).
- **Needs AWS, a model or a third-party API?** Then it's website-only and goes outside these files.
