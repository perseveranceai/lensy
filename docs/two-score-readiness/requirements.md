# Requirements: two readiness scores

Source of truth: [`spec.md`](spec.md). Section numbers below (§) refer to it. If this file and the spec disagree, the spec wins; fix this file.

## R1. Honest fetcher (§7)
- WHEN Lensy fetches a page, robots.txt, sitemap, llms.txt or a `.md` URL, THEN it SHALL send `User-Agent: Lensy/1.0 (+https://perseveranceai.com/bot)` first.
- WHEN that request returns 403 or 429, THEN Lensy SHALL retry once with the browser user agent.
- WHEN both are refused, THEN the scan SHALL end with reason `blocked-by-bot-protection` and the UI SHALL say the site's bot protection blocked the checker, never "unreachable".
- WHEN a request fails at the network level (DNS, timeout), THEN it SHALL NOT be reported as blocked or "not found".
- Every audit row SHALL include `submittedUrl`, `finalUrl`, `httpStatus` and `ipHash`.

## R2. Reachability (§4.1)
- The report SHALL show gate state `pass` (the honest name worked) or `warn` (only the browser fallback worked). Neither state changes the scores.
- The report SHALL list which of OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot and Claude-User robots.txt disallows for the page path.

## R3. Coding agents score (§4.2)
- The report SHALL include a Coding agents score of 0–100, from checks C1–C6 with exactly the rules and points in §4.2.

## R4. AI search score (§4.3, §4.4)
- The report SHALL include an AI search score of 0–100, from checks S1–S6 with exactly the rules and points in §4.3 and §4.4.
- Freshness SHALL score declared and believable dates, not age. Age is shown as information only.

## R5. Data compatibility (§6)
- `report.json` SHALL carry `scoringVersion: 2`, `scores` and `gate`, and keep `overallScore` (set to the AI search score) and `scoreBreakdown` until §10 step 6.
- A report without `scoringVersion: 2` SHALL render in the legacy view with a re-scan note.

## R6. Report UI (§8)
- The hero SHALL show two score cards (AI search, Coding agents). Clicking one filters the signals to its checks.
- The AI-citations card and views SHALL be hidden unless `REACT_APP_CITATIONS_ENABLED=true`.
- Markdown and PDF downloads SHALL show both scores and match the page.
- The home page tiles and the education/research copy SHALL match §8.5.

## R7. Accuracy against the prototype
- For each saved fixture (§9.1), the implementation's per-check points SHALL equal the output of `node docs/two-score-readiness/prototype.mjs` on the same captured responses, within 0.5 points per check.

## R8. Tests and process (§9, AGENTS.md)
- Tests SHALL ship in the same commit as the code they cover.
- Bug fixes SHALL get the next REG id and a row in `docs/test-cases.md`.
- Nothing SHALL be deployed to prod by an agent.
