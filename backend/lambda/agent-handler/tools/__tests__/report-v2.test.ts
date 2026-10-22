// report.json v2 fields (spec §6.1, tasks 2.5), built from a captured fixture.
import { collectSignalsV2 } from '../collect-signals-v2';
import { buildScoringV2 } from '../generate-report';
import { loadFixture, pageInputFromFixture, replayFetch } from './replay';

test('stripe-payments: scoringVersion 2, both scores, gate, tips and the agent preview', async () => {
    const { entries, expected } = loadFixture('stripe-payments');
    const signals = await collectSignalsV2(pageInputFromFixture(entries, expected.url), { fetchImpl: replayFetch(entries), now: Date.parse('2026-10-22T12:00:00Z') });
    const v2 = buildScoringV2(JSON.parse(JSON.stringify(signals))); // as read back from S3
    expect(v2.scoringVersion).toBe(2);
    expect(v2.scores.codingAgents.score).toBe(87);
    expect(v2.scores.aiSearch.score).toBe(80);
    expect(v2.scores.codingAgents.checks.map(c => c.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
    expect(v2.scores.aiSearch.checks.map(c => c.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    for (const c of [...v2.scores.codingAgents.checks, ...v2.scores.aiSearch.checks]) {
        expect(c.points).toBeLessThanOrEqual(c.max);
        expect(['pass', 'warn', 'fail']).toContain(c.status);
        if (c.status !== 'pass') expect(c.fix).toBeTruthy();
    }
    expect(v2.gate).toMatchObject({ state: 'pass', via: 'honest', honestStatus: 200, robotsBlocks: [] });
    expect(v2.agentPreview.format).toBe('markdown');
    expect(v2.agentPreview.approxTokens).toBe(Math.round(v2.agentPreview.chars / 4));
});
