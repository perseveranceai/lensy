// The check registry must describe exactly the checks the engine returns
// (lensy-cli Req 6.4): same ids, labels and max points, with an explanation and
// evidence for each, and no customer names (it is published to npm).
import fs from 'fs';
import path from 'path';
import { CHECKS, CHECKS_BY_ID } from '../check-registry';
import { collectSignalsV2 } from '../collect-signals-v2';
import { scoreCodingAgents, scoreAiSearch } from '../scoring-v2';
import { loadFixture, pageInputFromFixture, replayFetch } from './replay';

test('every check the engine returns has a registry entry with the same label, max and score', async () => {
    const { entries, expected } = loadFixture('stripe-payments');
    const s = await collectSignalsV2(pageInputFromFixture(entries, expected.url), { fetchImpl: replayFetch(entries), now: Date.parse('2026-10-22T12:00:00Z') });
    const returned = [
        ...scoreCodingAgents(s).checks.map(c => ({ ...c, score: 'codingAgents' })),
        ...scoreAiSearch(s).checks.map(c => ({ ...c, score: 'aiSearch' })),
    ];
    expect(CHECKS.map(c => c.id)).toEqual(returned.map(c => c.id));
    for (const c of returned) {
        expect(CHECKS_BY_ID[c.id]).toMatchObject({ label: c.label, max: c.max, score: c.score, source: 'lensy' });
    }
});

test('every entry has measures, why and at least one https evidence link', () => {
    for (const c of CHECKS) {
        expect(c.measures.length).toBeGreaterThan(20);
        expect(c.why.length).toBeGreaterThan(20);
        expect(c.evidence.length).toBeGreaterThan(0);
        for (const e of c.evidence) expect(e.url).toMatch(/^https:\/\//);
        if (c.hostDependent) expect(c.hostNote).toBeTruthy();
    }
});

test('host dependence: C2 full; C3 and S3 partial; the rest none', () => {
    expect(CHECKS.filter(c => c.hostDependent === 'full').map(c => c.id)).toEqual(['C2']);
    expect(CHECKS.filter(c => c.hostDependent === 'partial').map(c => c.id)).toEqual(['C3', 'S3']);
});

test('no customer names in the published registry', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'check-registry.ts'), 'utf8');
    // The first site that reported the bot-protection issue; already named in docs/two-score-readiness.
    expect(src).not.toMatch(/branch\.io|\bBranch\b/i);
});
