# Tasks: two readiness scores

Work top to bottom. Each PR branches fresh from `origin/main`, never from a stale local branch. Before pushing, run `cd frontend && npm run pre-cr` (AGENTS.md). Never deploy prod.
Spec: [`spec.md`](spec.md). Requirements: [requirements.md](requirements.md). Design: [design.md](design.md).

## PR 1: honest fetcher (§7) — fixes the Branch case on its own

- [ ] 1.1 Add `backend/lambda/agent-handler/shared/fetch-page.ts`:
  - `fetchPage(url, { accept })` returns `{ ok, status, finalUrl, headers, body, via: 'honest'|'browser', errorKind?: 'network'|'blocked' }`.
  - Use the honest user agent first; retry once with the browser user agent on 403 or 429.
  - _R1_
- [ ] 1.2 Use it in `agent.ts` (prefetch) and `check-ai-readiness.ts` (`checkUrl`, page fetch).
  - Both refused: reject with `blocked-by-bot-protection` (keep `unreachable-url` for real network failures).
  - _R1_
- [ ] 1.3 Audit rows: add `submittedUrl`, `finalUrl`, `httpStatus` and `ipHash` in `writeAuditLog` calls. _R1_
- [ ] 1.4 Frontend: map `blocked-by-bot-protection` to its own error card, with copy from §7. _R1_
- [ ] 1.5 Tests:
  - Jest unit tests for `fetchPage` with a mocked `fetch`, covering the four cases in the REG-18 row (§9.2). This is the first backend test, so make sure `npm --prefix backend test` runs, and add it to `scripts/pre-cr.sh` and CI.
  - Playwright REG-18 UI part (mocked status, `download.spec.ts` pattern).
  - Add the REG-18 row and URLs U-10/U-11 to `docs/test-cases.md`.
- [ ] 1.6 On gamma, after merge: scan `https://help.branch.io` and `https://help.branch.io/account-hub/onboarding-guide` five times each. All should complete. Report the gate state.

**Done when:** pre-cr passes; REG-18 passes; the Branch scans complete on gamma.

## PR 2: scoring v2 backend (§4, §6)

- [ ] 2.1 Fixture capture script `backend/scripts/capture-fixtures.mjs`.
  - For a URL, save the raw responses (HTML; `Accept: text/markdown` response; `.md`; robots.txt; sitemap files; llms.txt plus sampled link statuses) to `backend/lambda/agent-handler/tools/__tests__/fixtures/<name>/`.
  - Capture the 9 pages in §5, U-1, U-2, U-4, U-5, U-6, U-7, and the edge fixtures in §9.1 (hand-written).
- [ ] 2.2 Collect the new signals in `check-ai-readiness.ts` / `detection-engine.ts`:
  - llms.txt link sample and size; received content and its size;
  - headings from Markdown and from HTML (keep article `<header>`); heading ids; section lengths;
  - sitemap index walk with `lastmod`; page dates;
  - robots.txt evaluation for the six AI bots.
  - _R2–R4_
- [ ] 2.3 `tools/scoring-v2.ts`: pure functions implementing C1–C6, S1–S6 and the gate exactly as in §4. Include the two validated fixes (C5 under 40 words = 0; skip points need at least 2 headings). _R3, R4_
- [ ] 2.4 Fix the bugs listed in §6.3:
  - hardcoded `llmsTxtFound`;
  - `checkUrl` accepting soft-404 HTML;
  - header stripping;
  - network error treated as "not found".
  - Each gets a REG id (REG-19, REG-20 and the next free ones).
- [ ] 2.5 `generate-report.ts`:
  - write `scoringVersion: 2`, `scores` and `gate`;
  - keep `overallScore` (= AI search) and `scoreBreakdown`;
  - regenerate `SIGNAL_IMPACT` from the new weights.
  - Add `codingScore`, `searchScore` and `scoringVersion` to the audit row.
  - _R5_
- [ ] 2.6 Jest tests over fixtures:
  - Per check, the points must equal the prototype's output on the same fixtures (_R7_). To get expected values, point the prototype at a local server that replays the fixture files, or port its rules into the test as a table.
  - Also cover the edge cases in §9.1.

**Done when:** all fixture tests pass; the §5 table reproduces from fixtures within 0.5 points per check; pre-cr passes.

## PR 3: report UI (§8)

- [ ] 3.1 Hero:
  - two score cards (AI search, Coding agents) replace the score card and the citations card (`AppRoutes.tsx` around 800–805);
  - `view` gains `coding` and `search`; clicking a card filters the signals.
  - _R6_
- [ ] 3.2 Reachability banner replaces the bot-access banner (line 910):
  - honest/browser status;
  - the six AI bots;
  - the mismatch warning;
  - the JavaScript-blocked message.
  - _R2, R6_
- [ ] 3.3 `reportModel.ts`:
  - groups "Both audiences / Coding agents / AI search", `points/max` on each signal;
  - fix copy for C2–C6 and S4 (platform-specific where detected);
  - the "what an agent receives" preview.
  - _R6_
- [ ] 3.4 Citations behind `REACT_APP_CITATIONS_ENABLED`, default off in `.env.gamma` and `.env.production`. The download doesn't offer or trigger citations when it's off. _R6_
- [ ] 3.5 Downloads show both scores, the gate and the agent-preview summary (H-001 parity). _R6_
- [ ] 3.6 Legacy view for reports without `scoringVersion: 2`, with a re-scan note. _R5_
- [ ] 3.7 Copy:
  - home tiles (line 993) and "score out of 100" (line 962);
  - remove the unsupported JSON-LD claim on the research page (around line 1091);
  - regenerate `/education/*.md`.
  - _R6_
- [ ] 3.8 `FeedbackWidget` and the feedback email send both scores (§6.2a).
- [ ] 3.9 E2E per §9.2:
  - update S-02, S-03 (retire explicitly), S-06, S-08 and download.spec;
  - add S-09 and S-10;
  - add a v2 fixture `report-stripe-v2.json`, keep the v1 fixture;
  - check both themes and 375 px.
  - Update `docs/test-cases.md`.

**Done when:** pre-cr passes on a production build; screenshots of the new hero in light and dark at 1280 px and 375 px are attached to the PR.

## After PR 3 merges (gamma)
- [ ] 4.1 Scan every §5 page and U-1 to U-7 on gamma. Each score must be within ±3 of §5 / §12, or the PR comment explains the difference.
- [ ] 4.2 Hand back to Rakesh for the prod approval. Agents don't deploy prod.
