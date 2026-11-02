// SPDX-License-Identifier: MIT
// The only file in packages/ that reaches into the website's engine. Every
// engine import goes through here so the boundary test has one place to check.
// The engine runs in place: nothing is copied (lensy-engine.md).
export { fetchPage, ACCEPT_HTML, headersToRecord } from '../../../backend/lambda/agent-handler/shared/fetch-page';
export type { FetchPageResult } from '../../../backend/lambda/agent-handler/shared/fetch-page';
export { collectSignalsV2 } from '../../../backend/lambda/agent-handler/tools/collect-signals-v2';
export type { PageInput, SignalsV2, Platform } from '../../../backend/lambda/agent-handler/tools/collect-signals-v2';
export { buildScoringV2 } from '../../../backend/lambda/agent-handler/tools/report-v2';
export type { ScoringV2Fields } from '../../../backend/lambda/agent-handler/tools/report-v2';
export type { CheckResult, ScoreResult, GateResult } from '../../../backend/lambda/agent-handler/tools/scoring-v2';
export { CHECKS, CHECKS_BY_ID } from '../../../backend/lambda/agent-handler/tools/check-registry';
export type { CheckMeta } from '../../../backend/lambda/agent-handler/tools/check-registry';
