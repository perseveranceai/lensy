// SPDX-License-Identifier: MIT
/**
 * The v2 fields of report.json (docs/two-score-readiness/spec.md §6.1), built
 * from SignalsV2. Pure: shared by the website (generate-report.ts) and the
 * Lensy CLI (packages/core), so both write the same scores, gate, tips and
 * agent preview. See .kiro/steering/lensy-engine.md.
 */
import { scoreCodingAgents, scoreAiSearch, gateState, tipsV2, ScoreResult, GateResult, Tip } from './scoring-v2';
import type { SignalsV2 } from './collect-signals-v2';

/** "What an agent receives" preview under the Coding agents card (spec §8.2). */
export interface AgentPreview {
    format: 'markdown' | 'html';
    chars: number;
    approxTokens: number;
    /** Share of the page a 100K-character fetch window covers (1 = all of it). */
    windowShare: number;
    url: string;
}

/** The v2 part of report.json (spec §6.1). Absent on reports scored before v2. */
export interface ScoringV2Fields {
    scoringVersion: 2;
    scores: { codingAgents: ScoreResult; aiSearch: ScoreResult };
    gate: GateResult;
    tips: Tip[];
    agentPreview: AgentPreview;
}

export const AGENT_WINDOW_CHARS = 100000;

export function buildScoringV2(signals: SignalsV2): ScoringV2Fields {
    const r = signals.received;
    return {
        scoringVersion: 2,
        scores: { codingAgents: scoreCodingAgents(signals), aiSearch: scoreAiSearch(signals) },
        gate: gateState(signals),
        tips: tipsV2(signals),
        agentPreview: {
            format: r.format,
            chars: r.chars,
            approxTokens: Math.round(r.chars / 4),
            windowShare: r.chars <= AGENT_WINDOW_CHARS ? 1 : Math.round((AGENT_WINDOW_CHARS / r.chars) * 100) / 100,
            url: r.format === 'markdown' ? (signals.contentNegotiation.ok ? signals.finalUrl : signals.markdownUrl.url) : signals.finalUrl,
        },
    };
}
