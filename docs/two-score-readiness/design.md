# Design: two readiness scores

Full design: [`spec.md`](spec.md) §4–§8. This page lists only the decisions an implementer needs first.

## Decisions (don't revisit without asking Rakesh)
- **Two scores, not one.** Every scored check needs evidence (§3) or a test we ran. Don't add a check because another tool (Fern/AFDocs) has it.
- **Reachability is a banner, not a cap** (§4.1). A block on Lensy's own name doesn't prove real agents are blocked.
- **Never send other companies' crawler names** (no fake `ClaudeBot` or `GPTBot` requests).
- **Coding-agent checks score what an agent receives** (Markdown when offered). **AI-search checks score the HTML**, which is what crawlers get.
- **Freshness scores declared and believable dates, not age.**
- **AI citations are hidden, not deleted** (`REACT_APP_CITATIONS_ENABLED`).

## Where things go
| Concern | File(s) |
|---|---|
| Shared fetch helper (honest UA, fallback, error kinds) | new `backend/lambda/agent-handler/shared/fetch-page.ts`; used by `agent.ts` (prefetch) and `tools/check-ai-readiness.ts` (`checkUrl`, `FETCH_HEADERS`) |
| Signal collection (new probes) | `tools/check-ai-readiness.ts`, `tools/detection-engine.ts` (reuse the probes at line 304) |
| Scoring (pure functions, no I/O) | new `tools/scoring-v2.ts`: `scoreCodingAgents(signals)`, `scoreAiSearch(signals)`, `gateState(signals)` |
| Report assembly | `tools/generate-report.ts` (`scores`, `gate`, `scoringVersion`; regenerate `SIGNAL_IMPACT`) |
| Audit log | `agent.ts` `writeAuditLog` |
| Report UI | `frontend/src/AppRoutes.tsx` (`ScanReport` hero around line 800, banner at 910); `frontend/src/report/reportModel.ts` (`buildReportModel` groups) |
| Downloads | `frontend/src/report/exportReport.ts`, `markdown.ts`, `pdf.ts`, `useReportDownload.ts` |

**Keep scoring pure.** `scoring-v2.ts` takes a plain `signals` object and returns points. All network work happens in collection. That's what makes fixture tests deterministic.

## Reference oracle
`docs/two-score-readiness/prototype.mjs` implements §4 exactly and produced every number in §5 and §12. When in doubt, match its behaviour. If you think the prototype is wrong, raise it rather than diverging silently.
