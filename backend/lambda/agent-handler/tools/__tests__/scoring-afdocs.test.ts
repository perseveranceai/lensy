// Coding agents score from AFDocs (spec docs/coding-agents-afdocs/spec.md).
// Fixtures are real AFDocs 0.22.2 single-page runs captured on 2026-10-29.
import fs from 'fs';
import path from 'path';
import { scoreCodingAgentsAfdocs, headingsShare, HEADINGS_ID } from '../scoring-afdocs';
import { runAfdocsOnPage, AFDOCS_OPTIONS, AfdocsRun } from '../afdocs-page';
import type { SignalsV2 } from '../collect-signals-v2';

const run = (name: string): AfdocsRun =>
    JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'afdocs', `${name}.json`), 'utf8'));

const signals = (h: Partial<SignalsV2['receivedHeadings']>) =>
    ({ receivedHeadings: { count: 6, h1Count: 1, skips: 0, generic: 0, ...h } }) as SignalsV2;

describe('scoreCodingAgentsAfdocs without Lensy checks equals AFDocs\' own score', () => {
    for (const [name, expected] of [['branch-onboarding', 97], ['stripe-payments', 90], ['docusaurus-docs', 59], ['vitest-guide', 86], ['react-learn', 92]] as const) {
        test(name, () => {
            const r = scoreCodingAgentsAfdocs(run(name));
            expect(r.score).toBe(expected);
            expect(r.afdocsScore).toBe(expected);
            expect(r.source).toBe('afdocs');
        });
    }
});

test('skipped checks are left out, failing checks carry the AFDocs fix', () => {
    const r = scoreCodingAgentsAfdocs(run('stripe-payments'));
    expect(r.checks.map(c => c.id)).not.toContain('auth-alternative-access'); // skip
    const fail = r.checks.find(c => c.id === 'llms-txt-directive-md')!;
    expect(fail.status).toBe('fail');
    expect(fail.points).toBe(0);
    expect(fail.fix).toBeTruthy();
    expect(fail.label).toBe('Page points agents to llms.txt (Markdown)');
    for (const c of r.checks) {
        expect(c.points).toBeLessThanOrEqual(c.max);
        if (c.status === 'pass') expect(c.fix).toBeUndefined();
    }
});

test('no llms.txt keeps the AFDocs cap at 59 even with Lensy checks added', () => {
    const r = scoreCodingAgentsAfdocs(run('docusaurus-docs'), signals({}));
    expect(r.cap?.checkId).toBe('llms-txt-exists');
    expect(r.score).toBe(59);
});

test('Lensy headings check is added in the medium tier (4 points)', () => {
    const base = run('vitest-guide');
    const good = scoreCodingAgentsAfdocs(base, signals({}));
    const bad = scoreCodingAgentsAfdocs(base, signals({ h1Count: 2, skips: 2 }));
    const h = good.checks.find(c => c.id === HEADINGS_ID)!;
    expect(h).toMatchObject({ max: 4, points: 4, status: 'pass', category: 'lensy' });
    expect(bad.checks.find(c => c.id === HEADINGS_ID)).toMatchObject({ points: 0.8, status: 'warn' });
    expect(bad.score).toBeLessThan(good.score);
});

test('headingsShare: one H1 and no skips is full; a page with fewer than 2 headings gets no outline credit', () => {
    expect(headingsShare(signals({}))).toBe(1);
    expect(headingsShare(signals({ skips: 1 }))).toBe(0.75);
    expect(headingsShare(signals({ count: 1 }))).toBe(0.5);
    expect(headingsShare(signals({ h1Count: 0, count: 0 }))).toBe(0);
});

describe('runAfdocsOnPage', () => {
    test('runs single-page mode and keeps plain JSON', async () => {
        const calls: any[] = [];
        const load = async () => ({
            runChecks: async (url: string, o: any) => { calls.push([url, o]); return { results: [{ id: 'llms-txt-exists', category: 'content-discoverability', status: 'pass', message: 'ok', details: { big: 1 } }], requestSummary: { requests: 3 } }; },
            computeScore: () => ({ overall: 100, checkScores: { 'llms-txt-exists': { earnedScore: 10, maxScore: 10, scoreDisplayMode: 'numeric', extra: 1 } }, resolutions: {} }),
        });
        const r = await runAfdocsOnPage('https://docs.example.com/a', { load });
        expect(calls[0][0]).toBe('https://docs.example.com/a');
        expect(calls[0][1]).toMatchObject({ samplingStrategy: 'none', skipCheckIds: AFDOCS_OPTIONS.skipCheckIds });
        expect(r?.results[0]).toEqual({ id: 'llms-txt-exists', category: 'content-discoverability', status: 'pass', message: 'ok' });
        expect(r?.score.checkScores['llms-txt-exists']).toEqual({ earnedScore: 10, maxScore: 10, scoreDisplayMode: 'numeric' });
        expect(r?.requests).toBe(3);
    });

    test('a failure or a timeout returns undefined instead of throwing', async () => {
        await expect(runAfdocsOnPage('https://x', { load: async () => { throw new Error('no module'); } })).resolves.toBeUndefined();
        const hang = async () => ({ runChecks: () => new Promise(() => {}), computeScore: () => ({}) });
        await expect(runAfdocsOnPage('https://x', { load: hang, timeoutMs: 20 })).resolves.toBeUndefined();
    });
});
