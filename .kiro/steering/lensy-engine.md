---
inclusion: fileMatch
fileMatchPattern: "{backend/lambda/agent-handler/**/{fetch-page,html-content,collect-signals-v2,scoring-v2,scoring-afdocs,afdocs-page,report-v2,check-registry}.ts,frontend/src/report/report-view.ts}"
---

# This file is shared by the website and the CLI

The website (the agent Lambda) and the `lensy` CLI (`packages/`) both run this file. A change here ships to both.

## Shared files

Engine, in `backend/lambda/agent-handler/`:
- `shared/fetch-page.ts`: every request to the site being checked (`fetchPage`, `honestFetch`)
- `shared/html-content.ts`: text, headings, sections, Markdown detection
- `tools/collect-signals-v2.ts`: all network work for a page, giving `SignalsV2`
- `tools/afdocs-page.ts`: runs AFDocs on one page, routing its requests through `honestFetch`
- `tools/scoring-afdocs.ts`: the Coding agents score from AFDocs results, plus the Lensy heading check
- `tools/scoring-v2.ts`: pure scoring (C1–C6 fallback, S1–S6), gate, tips, fix copy
- `tools/report-v2.ts`: `buildScoringV2()` and the report fields built from it
- `tools/check-registry.ts`: one entry per check (id, label, max points, source, host notes, explanation, evidence)

Report view, in `frontend/src/report/report-view.ts`: check grouping, fix order, the reachability banner and the agent preview line. It's used by the website's report and the CLI's reports.

## Rules

- **Keep it pure.**
  - Don't import AWS SDKs, LangChain, `s3-helpers`, `progress-publisher`, React, or `process.env`.
  - Make network calls only through `fetch-page.ts`, with `fetchImpl` injectable. The CLI's boundary test fails otherwise.
- **No secrets or private data.** The CLI publishes this code to npm: no credentials, account IDs, internal hostnames or customer names, including in comments and fix text.
- **Anything scored belongs here:** checks, points, findings, fixes, gate state, tips, the agent preview. Other website code and the CLI may display results but must not compute them.
- **Adding or changing a check:**
  - update `check-registry.ts` in the same PR;
  - add the scoring test in `tools/__tests__/`;
  - run both suites (`cd backend && npm test`, `cd packages && npm test`), including the parity tests.
- **Adding a field to the report output:** map it into `packages/core/src/report.ts`, or list it in `WEBSITE_ONLY` there.
- **Fetching is honest.** The website names itself `Lensy/1.0` and may retry once with a browser user agent on 403 or 429. The CLI names itself `lensy-cli/<version>` and never retries. Never send other companies' crawler names.
- **Needs AWS, a model or a third-party API?** Then it's website-only and goes outside these files.
