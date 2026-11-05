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

// AFDocs checks (docs/coding-agents-afdocs/spec.md criterion 7).
describe('AFDocs checks in the registry', () => {
    const { AFDOCS_CHECKS } = require('../check-registry');
    const { scoreCodingAgentsAfdocs } = require('../scoring-afdocs');
    const run = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'afdocs', 'stripe-payments.json'), 'utf8'));
    const afdocs = AFDOCS_CHECKS.filter((c: any) => c.source === 'afdocs');

    test('every check AFDocs 0.23.0 runs has an entry, and nothing else', () => {
        expect(afdocs.map((c: any) => c.id).sort()).toEqual(run.results.map((r: any) => r.id).sort());
    });

    test('labels are the ones the scorer shows; max is at least what a run can earn', () => {
        const scored = scoreCodingAgentsAfdocs(run, { receivedHeadings: { count: 5, h1Count: 1, skips: 0, generic: 0 } } as any);
        for (const c of scored.checks) {
            const meta = CHECKS_BY_ID[c.id];
            expect(meta).toBeDefined();
            expect(meta.label).toBe(c.label);
            expect(meta.max).toBeGreaterThanOrEqual(c.max);
            expect(meta.score).toBe('codingAgents');
        }
    });

    test('tier weights only, measures and why, an https spec link, a note when host-dependent', () => {
        for (const c of afdocs) {
            expect([10, 7, 4, 2]).toContain(c.max);
            expect(c.measures.length).toBeGreaterThan(20);
            expect(c.why.length).toBeGreaterThan(20);
            expect(c.evidence[0].url).toMatch(/^https:\/\/agentdocsspec\.com\/spec\/web\/[a-z-]+\/#[a-z-]+$/);
            if (c.hostDependent) expect(c.hostNote).toBeTruthy();
        }
    });

    test('Lensy checks kept alongside AFDocs: lensy-headings', () => {
        expect(AFDOCS_CHECKS.filter((c: any) => c.source === 'lensy').map((c: any) => c.id)).toEqual(['lensy-headings']);
    });
});
